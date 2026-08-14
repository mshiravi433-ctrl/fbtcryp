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
    '/earn', '/leaderboard',    // -> /rewards
    /*
     * Solana is a TAB inside /swap now, on the owner's instruction. The route
     * is deliberately kept alive rather than deleted: links to it are already
     * shared, and Stocks and Farm hand off to it with ?to=<mint>. A menu entry
     * is discovery; a route is a contract with everything that already links
     * to it.
     */
    '/solana',                  // -> tab inside /swap
    '/ostium', '/dydx', '/derivatives' // -> derivatives / stocks tabs
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
      'addSubscription',
      'removeSubscription',
      'fcmSelfTest',
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
    t(
      'the WC metadata uses the canonical public identity helper',
      wallet.includes("publicAppUrl('/')")
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

    /* A square app icon makes a weak large-image preview in Telegram/X. The
       social card is a real wide PNG, and both root tags must use it so every
       shared link has the same recognisable visual identity. */
    t('a wide social card is published', existsSync('public/social-card.png'));
    t('root social tags use the wide social card',
      /og:image" content="https:\/\/fbtswap\.ir\/social-card\.png/.test(html) &&
      /twitter:image" content="https:\/\/fbtswap\.ir\/social-card\.png/.test(html));

    /* The SPA needs JavaScript, but a no-JS visitor must not be left behind a
       permanent boot spinner. This is visible fallback content—not a hidden
       keyword block—and gives lightweight crawlers real paths to the guides. */
    t('the homepage has a readable no-JS fallback linked to the guides',
      /<noscript>[\s\S]*?id="no-js-content"[\s\S]*?صرافی-غیرمتمرکز/.test(html));

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
     * ─── AND THE CLASS NAME ITSELF MUST BE REAL ─────────────────────────────
     * The check above only inspects files that ALREADY say
     * `className="segmented"`. TapToPay was written with an invented
     * `className="seg"` and `seg-on`, neither of which exists in index.css,
     * so it matched no rule, inherited no styling, and sailed past this sweep
     * entirely. Reported as «دکمه های nfc طوسی شکل اندازه و رنگ نامناسب دارند»
     * — grey, wrong size, wrong colour. They were simply unstyled.
     *
     * A misspelt class is invisible in review and invisible to a build: CSS
     * has no such thing as an unknown-selector error. So the defined class
     * list is read out of the stylesheet and every tab-like className in the
     * source is required to appear in it.
     */
    {
      const css = read('src/index.css');
      const defined = new Set(
        [...css.matchAll(/\.([a-z][a-z0-9-]*)\s*(?:\{|,|:|\s+[.a-z[])/gi)].map((m) => m[1])
      );
      /*
       * Strip comments FIRST. This file EXPLAINS the wrong class name in its
       * own header, and a check that matched its own rationale would fail
       * forever while the code was correct — trap #1 in this suite, hit again
       * on the very commit that added this check.
       */
      const strip = (src) => src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      const bogus = [];
      for (const f of files) {
        const src = strip(read(f));
        for (const m of src.matchAll(/className="([a-z][a-z0-9- ]*)"/gi)) {
          for (const cls of m[1].trim().split(/\s+/)) {
            /* Only audit the segmented-control family; a general sweep would
               drown in utility classes defined in other stylesheets. */
            if (!/^seg/.test(cls)) continue;
            if (!defined.has(cls)) bogus.push(`${f}:${cls}`);
          }
        }
      }
      t(
        `no screen uses an undefined seg* class${bogus.length ? ` — ${[...new Set(bogus)].join(', ')}` : ''}`,
        bogus.length === 0
      );
    }

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

    /*
     * THE RULE IS UNCHANGED; THE FLAG MOVED.
     *
     * The requirement is still that whatever decides to CHARGE also decides
     * what to ANNOUNCE. It used to be `solanaFeeReady()`, a Jupiter-referral
     * check. The screen no longer swaps through Jupiter, and that flag now
     * answers false — which would announce a free swap while charging 0.70%.
     *
     * The quote's own `feeBps` is the authority now: it is the literal value
     * the server put into the OpenOcean request, so the number announced and
     * the number charged are the same number, not two that agree by luck.
     */
    t(
      'the fee notice is driven by the quote that carries the charge',
      /order\?\.feeBps/.test(page) && /attachFee\(params\)/.test(read('server/solanaOcean.js'))
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

    /* The FAQ schema must mirror text a visitor can open on the page. This
       adds useful page structure without pretending invisible keywords are
       content, and makes the new Persian guides answer actual questions. */
    t('landing pages have visible FAQs and matching FAQ schema',
      /<details>/.test(gen) && /FAQPage/.test(gen));
    t('landing pages use the wide social card', /social-card\.png/.test(gen));

    /* These pages are marketing surfaces as well as documents. Keep the visual
       design intentional: a modern hero and small ambient motion are fine, but
       motion must always obey the visitor's reduced-motion preference. */
    t('landing pages have an animated modern hero and card layout',
      /hero-panel/.test(gen) && /ambient-grid/.test(gen) && /fact-card/.test(gen) && /@keyframes rise-in/.test(gen));
    t('landing motion respects prefers-reduced-motion', /prefers-reduced-motion/.test(gen));

    for (const slug of ['هشدار-قیمت-ارز-دیجیتال', 'تحلیل-تکنیکال-ارز-دیجیتال', 'کیف-پول-غیرامانی']) {
      t(`a substantive Persian feature page exists for ${slug}`, gen.includes(`slug: '${slug}'`));
    }

    /* A finance landing page without a risk statement is the kind of thing a
       store reviewer and a regulator both look for. */
    t('pages carry the risk statement', /Nothing here is financial advice/.test(gen));

    /*
     * The sitemap must be regenerated with them. Submitting one that omits
     * the new pages leaves the whole exercise depending on Google finding
     * them unaided.
     */
    t('the sitemap is regenerated', /sitemap\.xml/.test(gen));
    t('the sitemap does not manufacture a new lastmod on every build', !/<lastmod>/.test(gen));
  }

  /* ---- 35. advertised chains must actually exist ------------------------ */
  /*
   * REAL BUG, and it was the text Google had indexed: the <title> said
   * "9 Chains" and the description listed Tron. We now support nine EVM chains
   * plus Solana — ten — and there is no Tron swap route at all; chains.js
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

    /* The title was corrected while the Help answer and notification copy
       still said seven. A user who sees two different network counts assumes
       one of them is a phishing clone, so the live marketing surfaces and the
       script that regenerates their locale values must name Linea and Sonic. */
    const faq = read('src/lib/faqLocal.js');
    const promo = read('server/promos.js');
    const localeEn = read('src/i18n/locales/en.json');
    const localeFa = read('src/i18n/locales/fa.json');
    const localeAr = read('src/i18n/locales/ar.json');
    const localePatch = read('scripts/patch-i18n.mjs');
    t('the English support and promo copy includes Linea and Sonic',
      /Linea/.test(faq) && /Sonic/.test(faq) && /Linea/.test(promo) && /Sonic/.test(promo) &&
      /Linea/.test(localeEn) && /Sonic/.test(localeEn));
    t('the Persian and Arabic support copy includes the added chains',
      /لینیا/.test(localeFa) && /سونیک/.test(localeFa) && /لينيا/.test(localeAr) && /سونيك/.test(localeAr));
    t('the locale patch cannot restore the old seven-network promo',
      /Linea/.test(localePatch) && /Sonic/.test(localePatch) &&
      !/Swap across 7 networks|سواپ روی ۷ شبکه|التبادل على ٧ شبكات/.test(localePatch));
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
      /wal-buy/.test(wallet) && !/btn-sm"\s*\n\s*style=\{\{ width: '100%' \}\}/.test(wallet)
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
    const css = (
      read('src/index.css') +
      '\n' +
      readdirSync('src/styles')
        .filter((f) => f.endsWith('.css'))
        .map((f) => read(`src/styles/${f}`))
        .join('\n')
    ).replace(/\/\*[\s\S]*?\*\//g, '');
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

    /*
     * ─── AND THE COIN PAGE DELIBERATELY DOES NOT ────────────────────────────
     * Asked for: «نمای کلی هفتگی و ماهانه در صفحه نمودار هر توکن را حذف کن
     * باید در صفحه سیگنال فقط باشد».
     *
     * One answer, one home. The same panel used to render on both screens; on
     * a chart page that is the wrong emphasis, because someone opening a coin
     * wants the price and its history, not a stance card. Asserted as an
     * ABSENCE so re-adding it fails the build rather than quietly restoring
     * the duplicate.
     */
    t('the coin screen does NOT mount the verdict panel', !/<VerdictPanel/.test(detail));

    /*
     * The macro layer is the whole reason this engine is better than the old
     * one, and it is useless without a BTC series to compare against. A screen
     * that mounts the panel but passes no `btcSeries` gets a verdict with the
     * macro layer silently weighted to zero — working code, dead feature, and
     * invisible in review.
     *
     * Only Signals is checked now; CoinDetail has no panel to feed.
     */
    t('Signals passes a bitcoin series to the macro layer', /btcSeries=\{/.test(signals));
    t('Signals fetches one', /useChart\('bitcoin'/.test(signals));
    t('Signals passes global stats too', /global=\{/.test(signals));

    /*
     * The inputs must go with it. `analyze()`, the Bitcoin series and the
     * global stats were fetched on the coin page ONLY to feed that panel, and
     * useChart polls every 60 seconds — leaving them would be two live network
     * polls per coin view whose results nothing reads.
     */
    t('...and the coin page stopped fetching the inputs it no longer uses',
      !/useChart\('bitcoin'/.test(detail) && !/useGlobalStats/.test(detail));
    t('...including the technical analysis call', !/\banalyze\(/.test(detail));

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

    /*
     * This asserted the ABSENCE of a flat 0.70% claim, because Solana was
     * then free and the flat claim was a lie by omission. Solana now charges
     * the same 0.70%, so a single flat figure is the accurate statement and
     * the absence check would forbid telling the truth.
     *
     * What still must not appear is a rate quoted without saying it is shown
     * before signing — that is the part that makes it honest.
     */
    t('the landing page quotes the fee AND promises it is shown before signing',
      /shown on screen before you sign/.test(code(landing)));
    /*
     * WAS: asserted the landing page says Solana is NOT charged.
     *
     * That was true while Solana routed through Jupiter, which earned us
     * nothing because its fee needs on-chain accounts we have no SOL for.
     * Solana now routes through OpenOcean, which splits a verified 0.70%
     * inside the swap transaction — so the old sentence became a public,
     * indexed promise of a free swap that we charge for. Understating a fee
     * is the dangerous direction: the user finds out after signing.
     */
    t('...and quotes the same 0.70% for Solana, which is now charged there too',
      /0\.70% of the input amount/.test(landing) &&
      !/No platform fee on Solana/.test(landing));

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
    /* Same correction as above: the quote is the single source of the rate. */
    t('the screen picks its fee notice from the quote it just showed',
      /order\?\.feeBps\s*$/m.test(solPage) || /order\?\.feeBps/.test(solPage));
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

    /*
     * ─── `buy.noFee` IS GONE, AND ITS ABSENCE IS NOW THE ASSERTION ──────────
     * It read "we charge nothing on this page … no fee, no commission, no
     * referral cut". That was true while the Buy screen was only a directory
     * of routes. It stopped being true the moment the fiat panel above it
     * started earning a partner commission on purchases.
     *
     * A false statement about money, on a money screen, is the worst thing
     * this app could ship — so the string was deleted rather than softened.
     * The check flips accordingly: it now fails if anyone reinstates it,
     * because reinstating it means reinstating the lie.
     *
     * Disclosure did not disappear with it. The fiat panel itemises
     * ChangeNOW's own service-fee breakdown beside the amount, at the moment
     * it is entered, which is where a fee is actually read.
     */
    t('the retired "we take nothing" claim is not back in English', !hasKey(en, 'buy.noFee'));
    t('...nor in Persian', !hasKey(fa, 'buy.noFee'));
    t('...and the Buy screen no longer renders it', !/buy\.noFee/.test(read('src/pages/Buy.jsx')));
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
    t(`only gated website pages render the funding panel (${renderers.length})`,
      renderers.length === 2 &&
      renderers.some((f) => f.endsWith('src/pages/Perp.jsx')) &&
      renderers.some((f) => f.endsWith('src/pages/DerivativesDashboard.jsx')));
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
    /*
     * NOTE ON THE FILENAME: this guards the removed CHANGENOW integration,
     * which happened to live at server/crosschain.js. "crosschain" is a
     * generic word and a legitimate, unrelated cross-chain module would
     * collide with it — that is exactly what happened when the 0x/Tron route
     * was added, so that one is named server/xchain.js instead.
     *
     * The check therefore asserts the absence of CHANGENOW itself as well as
     * the old path, so it keeps guarding the thing it was written for rather
     * than reserving a common noun forever.
     */
    t('the ChangeNOW module is gone', !existsSync('server/crosschain.js'));
    t('...and no server module CODE references ChangeNOW',
      !/changenow/i.test(code(read('server/app.js'))));
    t('...and its client lib', !existsSync('src/lib/crosschain.js'));
    t('...and its screen', !existsSync('src/pages/Coins.jsx'));
    t('...and its route', !/path="\/coins"/.test(read('src/App.jsx')));
    t('...and its nav entry', !/nav\.coins/.test(read('src/components/MoreSheet.jsx')));
    t('...and its server routes', !/\/api\/crosschain/.test(read('server/app.js')));

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
    /*
     * ─── THE WARNING MOVED; IT DID NOT DISAPPEAR ────────────────────────────
     * It used to be a permanent red banner plus a red "Blocks Iran" badge on
     * all three rows. The owner's objection is a product point, not a
     * cosmetic one: «ما از همه جهان مشتری داریم نه فقط ایران». A user in
     * Ankara or Dubai met three red badges about a rule that does not apply
     * to them, which trains everybody — including the person it was written
     * for — to scroll past red.
     *
     * So the facts moved into RestrictionsSheet, one neutral tap away, as a
     * per-country table. The pairing this check enforces is unchanged in
     * substance: the desks may stay only while the disclosure exists and
     * remains reachable. Reachability is the part that is easy to lose, so
     * it is asserted as a CHAIN — sheet file exists, P2P imports it, P2P
     * renders it, P2P has a control that opens it, and the copy still names
     * OFAC and Iran.
     */
    const p2p = read('src/pages/P2P.jsx');
    t('the restrictions sheet exists', existsSync('src/components/RestrictionsSheet.jsx'));
    t('...the P2P screen imports it', /import RestrictionsSheet/.test(p2p));
    t('...renders it', /<RestrictionsSheet/.test(p2p));
    t('...and offers a control that opens it',
      /setRestrictOpen\(true\)/.test(p2p) && /restrict\.open/.test(p2p));
    {
      const en = JSON.parse(read('src/i18n/locales/en.json'));
      const fa = JSON.parse(read('src/i18n/locales/fa.json'));
      const sheet = read('src/components/RestrictionsSheet.jsx');
      /* Strip comments before matching. The explanatory notes above mention
         Iran and OFAC themselves, so an un-stripped check would pass on its
         own documentation — a trap this suite has fallen into three times. */
      const sheetCode = code(sheet);
      t('...the sheet still covers the blocked jurisdiction',
        /iran/i.test(sheetCode));
      t('...in both languages',
        hasKey(en, 'restrict.region.iran.note') && hasKey(fa, 'restrict.region.iran.note'));
      t('...and the copy names the sanctions reason', /OFAC/.test(en.restrict.region.iran.note));
      /*
       * The reason the move is an improvement, asserted rather than assumed:
       * the sheet must ALSO tell the many users for whom this works that it
       * works. A table listing only the blocked case is the old banner with
       * extra steps.
       */
      t('...and it states where this DOES work, not only where it does not',
        hasKey(en, 'restrict.region.turkey.note') && hasKey(en, 'restrict.region.uae.note') &&
        hasKey(en, 'restrict.region.eu.note'));
    }

    const buy = code(read('src/pages/Buy.jsx'));
    const onramps = ['moonpay', 'transak', 'simplex', 'banxa', 'guardarian', 'ramp.network'];
    const listed = onramps.filter((o) => buy.toLowerCase().includes(o));
    t(`the buy screen lists no card on-ramp that blocks the region${listed.length ? ` — found: ${listed.join(', ')}` : ''}`,
      listed.length === 0);
  }

  /* ---- 59. fiat on-ramp: earns for us, and can never become a swap ----- */
  {
    t('the fiat module exists', existsSync('server/fiat.js'));
    t('the client lib exists', existsSync('src/lib/fiat.js'));
    t('the panel exists', existsSync('src/components/FiatPanel.jsx'));

    const srv = read('server/fiat.js');
    const lib = read('src/lib/fiat.js');
    const panel = read('src/components/FiatPanel.jsx');
    const appSrc = read('server/app.js');
    const buy = read('src/pages/Buy.jsx');
    const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const srvCode = code(srv);

    /* The full chain — a panel nothing renders is the bug shipped twice. */
    t('the server imports it', /from '\.\/fiat\.js'/.test(appSrc));
    t('...and exposes a quote route', /\/api\/fiat\/quote/.test(appSrc));
    t('...and a status route', /\/api\/fiat\/status/.test(appSrc));
    t('the client calls the published path', /fiat\/quote/.test(lib));
    t('the panel calls the client lib', /getFiatQuote\s*\(/.test(code(panel)));
    /*
     * ─── THE PANEL IS OFF THE BUY SCREEN, AND THAT IS NOW THE REQUIREMENT ──
     * ChangeNOW told the owner fiat is suspended until September, so the
     * panel was pulled. It was NOT visibly broken — /api/fiat/status still
     * answered {"enabled":true} in production — so it rendered, accepted an
     * amount, and would only have failed when somebody pressed the button
     * with real money in hand.
     *
     * This check is INVERTED rather than deleted, because the danger now runs
     * the other way: nothing must quietly put a dead partner back on a money
     * screen. Everything below still verifies the module, its routes and its
     * client stay intact, so re-enabling is a one-line revert.
     */
    t('the Buy screen does NOT render the suspended fiat panel',
      !/<FiatPanel/.test(code(buy)));
    /*
     * The panel still ACCEPTS a mode and still keys off it — verified on the
     * component rather than the removed call site, so the wiring is preserved
     * for the day it goes back on the screen.
     */
    t('...though the panel still keys off buy/sell for when it returns',
      /mode === 'sell'/.test(code(panel)));

    /*
     * ─── THE LINE THAT KEEPS THIS FROM BECOMING A RIVAL SWAP ────────────────
     * The owner's instruction was exact: fiat yes, swap no, because we run our
     * own swap. `assertFiatLeg` enforces it in code rather than in a comment,
     * so "just adding one crypto pair" later is impossible without deleting
     * this guard — and this test.
     */
    t('the server enforces exactly one fiat leg', /export function assertFiatLeg/.test(srvCode));
    t('...and refuses anything else', /return null;/.test(srvCode));

    /*
     * The key is a real credential — it authenticates the account and carries
     * our commission settings. Unlike the public GMX referral code it must
     * never be VITE_-prefixed.
     */
    t('the API key stays server-side',
      /process\.env\.CHANGENOW_API_KEY/.test(srvCode) && !/VITE_CHANGENOW/.test(srv));

    /*
     * Two separate switches. ChangeNOW grant fiat per-partner after a
     * compliance review, so a key with fiat off fails every call. Reporting
     * "ready" on the key alone would render a form that never works.
     */
    t('a key alone does not claim fiat is live',
      /CHANGENOW_FIAT_ENABLED/.test(srvCode) && /fiatEnabled/.test(srvCode));
    t('...and the panel explains it instead of showing a dead form',
      /fiat\.notEnabled/.test(panel));

    /*
     * ─── THE DISPLAYED FEE MUST BE THE CHARGED FEE ──────────────────────────
     * The first version read CHANGENOW_FIAT_FEE, defaulted it to 1, and
     * printed "our fee: 1%" — while nothing anywhere deducted it. A label
     * with no mechanism behind it: users shown a fee we never charged, and us
     * earning nothing from it.
     *
     * The real commission is a property of the partner account, applied by
     * ChangeNOW to any request carrying our key and reported inside their own
     * `service_fees` array. So the panel must render THEIR itemised
     * breakdown, and must not render an invented percentage of ours.
     */
    t('the panel shows their itemised service fees', /serviceFees/.test(panel));
    t('...and the network fee alongside it', /networkFee/.test(panel));
    t('...and explains whose fee it is', /fiat\.feeNote/.test(panel));
    t('the invented "our fee" percentage is not back', !/fiat\.ourFee/.test(panel));
    t('...and the server publishes no percentage of its own',
      !/ourFeePercent/.test(srvCode) && /feeModel/.test(srvCode));

    /*
     * ═══════════════════════════════════════════════════════════════════════
     * THE BUY SCREEN MUST NOT LEAD WITH A COUNTRY-SPECIFIC WARNING.
     * ═══════════════════════════════════════════════════════════════════════
     * The panel used to render `fiat.cardNotice` unconditionally — three
     * lines about Iranian bank cards and 2012 sanctions, shown to every user
     * on earth. A buyer in Berlin holding a German card read an explanation
     * of why a card they do not have will not work.
     *
     * The owner's instruction, twice:
     *     «ما از همه جهان مشتری داریم نه فقط ایران»
     *     «محدودیت روی اپ و سایت نزار»
     *
     * Two harms, and the second costs money. To most readers it is noise
     * inside a WARNING box, which teaches them to skip warning boxes. And to
     * a first-time visitor it reads as a claim about what this APP is — an
     * app whose checkout opens with a sanctions paragraph looks gated, when
     * in fact nothing here is gated at all.
     *
     * So the checks invert. What the panel must show is a country-NEUTRAL,
     * universally-true settlement note; what it must NOT show is the
     * jurisdiction paragraph.
     */
    t('the settlement note is country-neutral', /fiat\.settlementNote/.test(panel));
    t('the Iran-specific card paragraph is NOT on the buy screen',
      !/fiat\.cardNotice/.test(code(panel)));

    const en = JSON.parse(read('src/i18n/locales/en.json'));
    const fa = JSON.parse(read('src/i18n/locales/fa.json'));
    const ar = JSON.parse(read('src/i18n/locales/ar.json'));

    /* Neutral means neutral: no country may be named in the note itself. */
    t('...and names no country',
      !/Iran|ایران|إيران/i.test(en.fiat.settlementNote + fa.fiat.settlementNote + ar.fiat.settlementNote));
    /* It must still say something USEFUL, not just be inoffensive: the rule
       is that the CARD's country of issue decides, and that is true for
       every reader. */
    t('...but still states the actual rule',
      /issued/i.test(en.fiat.settlementNote));

    /*
     * ─── REMOVED, NOT DELETED: THE FACT STILL HAS TO BE REACHABLE ───────────
     * Dropping the Iran detail entirely would send somebody to enter card
     * details that cannot be authorised — a worse outcome than reading an
     * irrelevant paragraph. It lives in the Restrictions sheet, and the panel
     * must offer a way to open it. Asserted as a chain, because a fact that
     * exists in a component nobody can reach is the same as a deleted fact.
     */
    /*
     * ─── THE ONE UPSTREAM ERROR THAT NEEDS ITS OWN NAME ─────────────────────
     * Measured against the live deployment with the real key installed:
     * /api/fiat/quote returns "token not found for passed api-key". That is
     * NOT a broken key — the same key works on the swap API. It means fiat is
     * not enrolled on the partner account, which ChangeNOW grant separately
     * after a compliance review.
     *
     * Folded into the generic QUOTE_FAILED it reads as "something broke" and
     * sends the owner hunting Vercel for a typo that does not exist. Named,
     * it states the only action that can fix it.
     */
    t('an unenrolled fiat key is reported distinctly',
      /FIAT_KEY_NOT_ENROLLED/.test(srvCode));
    t('...and matched on the upstream message, not just a status code',
      /token not found/i.test(srvCode));
    t('...with copy that names the fix in all three languages',
      hasKey(en, 'fiat.err.FIAT_KEY_NOT_ENROLLED') &&
      hasKey(fa, 'fiat.err.FIAT_KEY_NOT_ENROLLED') &&
      hasKey(ar, 'fiat.err.FIAT_KEY_NOT_ENROLLED'));

    t('the panel offers the restrictions sheet', /<RestrictionsSheet/.test(panel));
    t('...with a control that opens it', /setRestrictOpen\(true\)/.test(panel));
    t('...and the sheet still carries the card-network fact',
      /Visa|Mastercard/.test(en.restrict.cards));
    t('...in all three written languages',
      hasKey(fa, 'restrict.cards') && hasKey(ar, 'restrict.cards'));

    /*
     * ─── AND THE SHEET MUST LEAD WITH WHAT IS NOT RESTRICTED ────────────────
     * A page titled "Restrictions" makes a reader assume the app restricts
     * them. It does not: there is no geofence and no IP check anywhere in
     * this repository. Letting that assumption stand is how a non-custodial
     * product gets mistaken for a gated one, so the intro must say so.
     */
    t('the restrictions intro states the app itself is not restricted',
      /non-custodial/i.test(en.restrict.intro) && /no country blocked/i.test(en.restrict.intro));
    t('...in Persian too', /محدود نیست/.test(fa.restrict.intro));
    /* The error for a crypto pair must point at OUR swap, not a competitor. */
    t('a crypto pair is redirected to our own swap',
      /own swap/i.test(en.fiat.err.NOT_A_FIAT_PAIR));

    const keys = [...panel.matchAll(/t\('(fiat\.[a-zA-Z0-9_.]+)'/g)].map((m) => m[1]);
    const missing = [...new Set(keys)].filter((k) => !hasKey(en, k));
    t(`every fiat.* key resolves (${new Set(keys).size} checked)` +
      (missing.length ? ` — missing: ${missing.join(', ')}` : ''), missing.length === 0);
    t('...and all are translated into Persian',
      [...new Set(keys)].every((k) => hasKey(fa, k)));
  }

  /* ---- 60. fiat: the call that actually earns must reach the API -------- */
  {
    /*
     * ═══════════════════════════════════════════════════════════════════════
     * THE BUG THIS CHECK WOULD HAVE CAUGHT, AND DID NOT EXIST TO CATCH.
     * ═══════════════════════════════════════════════════════════════════════
     * The first fiat integration passed every check in section 59 — module
     * present, route registered, panel rendered, key server-side, pair guard
     * enforced — and could not have earned a single cent, for two reasons
     * neither of which those checks looked at:
     *
     *   1. IT CALLED THE WRONG API. `/v2/exchange/estimated-amount` is the
     *      CRYPTO SWAP endpoint; it does not know what a fiat currency is.
     *      With a live key installed every request returned QUOTE_FAILED,
     *      which is exactly what the owner saw. The fiat family is a separate
     *      set of snake_case routes: /v2/fiat-estimate, /v2/fiat-transaction,
     *      /v2/fiat-market-info/…, authenticated with `x-api-key` rather than
     *      `x-changenow-api-key`.
     *
     *   2. IT NEVER CREATED A TRANSACTION. Commission is attributed to
     *      completed orders, never to quotes. There was no POST anywhere in
     *      the integration, so even a working quote would have earned nothing
     *      — the same "wired to nothing" shape already shipped twice, on the
     *      bridge and on the gasless swap.
     *
     * So this section asserts the REVENUE CHAIN specifically, endpoint by
     * endpoint, rather than the presence of files.
     */
    const srv = read('server/fiat.js');
    const srvCode = srv.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const app = read('server/app.js');
    const lib = read('src/lib/fiat.js');
    const panel = read('src/components/FiatPanel.jsx');

    /* ---- the right API family ---- */
    t('the quote calls the FIAT estimate endpoint', /\/fiat-estimate/.test(srvCode));
    t('...and not the crypto-swap one that never worked',
      !/exchange\/estimated-amount/.test(srvCode));
    t('the limits call the fiat market-info endpoint',
      /fiat-market-info\/min-max-range/.test(srvCode));
    /*
     * The header the fiat family reads. Sending only `x-changenow-api-key`
     * authenticates nothing there, which is the second reason the first
     * version could not have worked even with the right path.
     */
    t('the fiat auth header is sent', /'x-api-key'/.test(srvCode));

    /* ---- snake_case, because the fiat API does not accept camelCase ---- */
    t('the quote uses the fiat API parameter names',
      /from_currency/.test(srvCode) && /to_currency/.test(srvCode) && /from_amount/.test(srvCode));
    t('...including the network, which decides where the coins land',
      /to_network/.test(srvCode) && /from_network/.test(srvCode));

    /* ---- THE CHAIN THAT EARNS, end to end ---- */
    t('the server can create a transaction', /export async function fiatOrder/.test(srvCode));
    t('...by POSTing to the fiat transaction endpoint',
      /\/fiat-transaction/.test(srvCode) && /method: 'POST'/.test(srvCode));
    t('...the app registers the order route',
      /app\.post\('\/api\/fiat\/order'/.test(app));
    t('...and that route CALLS the module, not a stub',
      /await fiatOrder\(/.test(app));
    t('...the client library can reach it',
      /export function createFiatOrder/.test(lib) && /'\/fiat\/order'/.test(lib));
    t('...the panel imports it', /createFiatOrder/.test(panel));
    t('...and actually submits', /await createFiatOrder\(/.test(panel));
    /*
     * A created order the user cannot pay for is money they believe they have
     * committed and have not. The checkout URL must be opened AND kept on
     * screen, because a Custom Tab dismissed by accident otherwise strands
     * them with no way back.
     */
    t('...then opens the hosted checkout', /openUrl\(res\.redirectUrl\)/.test(panel));
    t('...and keeps a way back to it', /reopenCheckout/.test(panel));
    t('a missing checkout URL is treated as failure, not success',
      /NO_CHECKOUT_URL/.test(srvCode));

    /* The address is required before the order button does anything. A POST
       with an empty payout address is an order whose coins go nowhere. */
    t('an order without a payout address is refused', /BAD_ADDRESS/.test(srvCode));
    t('...and the button stays disabled until one is entered',
      /address\.trim\(\)\.length >= 16/.test(panel));

    /* The limits route, wired the same way and for the same reason. */
    t('the range route is registered', /app\.get\('\/api\/fiat\/range'/.test(app));
    t('...calls the module', /await fiatRange\(/.test(app));
    t('...and the panel uses it', /getFiatRange/.test(panel));
  }

  /* ---- 61. crypto radio: every station must be able to play ------------- */
  {
    /*
     * ─── WHY THIS IS AUDIO AND NOT THE VIDEO THAT WAS ASKED FOR ─────────────
     * The request was for "radio and television" on the news page. Video
     * means an embedded YouTube player, and youtube.com does not resolve on
     * most Iranian networks — the largest element on the news screen would be
     * a permanently grey box for the primary audience. That is the same
     * dead-button failure that got the Aparat "video" links removed when they
     * turned out to be searches returning nothing.
     *
     * The check below enforces the consequence: no iframe, no embed, no
     * third-party player script anywhere in this feature.
     */
    const srv = read('server/audio.js');
    const srvCode = srv.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const app = read('server/app.js');
    const lib = read('src/lib/audio.js');
    const panel = read('src/components/RadioPanel.jsx');
    const panelCode = panel.replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    const news = read('src/pages/News.jsx');
    const docs = read('src/pages/Docs.jsx');

    /* The full chain, module → route → route calls it → lib → component. */
    t('the audio module exists', existsSync('server/audio.js'));
    t('...the app registers a route', /app\.get\('\/api\/audio'/.test(app));
    t('...and that route CALLS the fetcher', /fetchAudio/.test(app));
    /*
     * Matched against the template literal the lib actually builds
     * (`${API_BASE}/audio`), not a quoted path string. The first version of
     * this check looked for `'/audio'` and failed on working code — a check
     * that fails on correct code teaches people to weaken checks.
     */
    t('...the client library reaches it', /\/audio`/.test(lib));
    t('...the panel imports it', /getAudio/.test(panel));
    t('...the news page renders it', /<RadioPanel/.test(news));

    /*
     * ─── AND THE EDUCATION PAGE MUST NOT ────────────────────────────────────
     * It used to render the same component too, which meant the identical
     * four feeds appeared under the headlines AND at the bottom of the
     * learning guides. Reported: «در مستندات رادیو کریپتو را پاک کن و بزار
     * داخل اخبار».
     *
     * Duplication is not extra reach, it is the app repeating itself — and it
     * doubles the upstream fetches for one set of episodes. This assertion is
     * inverted deliberately so putting it back fails the suite.
     */
    t('...and the education page no longer duplicates it', !/<RadioPanel/.test(docs));

    /*
     * On News it must be a TAB, not a section at the foot of the page. It was
     * previously below the headline list, the ad slot and the disclaimer —
     * several screens of scrolling on a phone, which in practice means nobody
     * reached it. A feature nobody reaches is the same as a feature nobody
     * has.
     */
    t('...reachable as a tab rather than buried below the fold',
      /news\.tab\.\$\{k\}/.test(news) && /tab === 'listen'/.test(news));
    /* The tab labels must exist, or the strip renders raw keys. Locales are
       read here rather than reusing `en`/`fa`, which are declared further
       down this block. */
    {
      const enL = JSON.parse(read('src/i18n/locales/en.json'));
      const faL = JSON.parse(read('src/i18n/locales/fa.json'));
      t('...and both tab labels are translated',
        hasKey(enL, 'news.tab.read') && hasKey(enL, 'news.tab.listen') &&
        hasKey(faL, 'news.tab.read') && hasKey(faL, 'news.tab.listen'));
    }

    /*
     * NO EMBEDS. The whole reason this is audio.
     * Comments are stripped first — the explanation above names YouTube and
     * iframes, and an un-stripped check would fail on its own documentation.
     * That exact trap has caught this suite three times.
     */
    t('the radio embeds no third-party video player',
      !/<iframe/i.test(panelCode) && !/youtube/i.test(panelCode));
    t('...and neither does the module', !/youtube|iframe/i.test(srvCode));

    /*
     * An episode with no playable file must never reach the UI. A play button
     * that plays nothing is precisely what this feature exists to avoid.
     */
    t('the parser requires a real audio enclosure', /<enclosure/.test(srvCode));
    /*
     * Pinned to the ACTUAL guard, anchored, rather than to the substring
     * "audio/" — which appears in a dozen innocent places and would pass for
     * a module that does no mime check at all. A generic match that succeeds
     * for both the right and the wrong implementation is not a test.
     */
    t('...and rejects a non-audio mime type', /!\/\^audio\\\/\/i\.test\(mime\)/.test(srvCode));
    t('...and refuses insecure URLs', /\^https/.test(srvCode));

    /*
     * ─── THE TRANSPORT — a real player, not a play button ─────────────────
     *   «mp player نداره تا بشه کنترلش کرد میخام mp player بسیار زیبا و مدرن
     *    باشد ... و در دو تم هم پویا باشد»
     *
     * The <audio> element and every control moved out of RadioPanel into
     * `AudioPlayer.jsx`, so these checks follow it. The list component now
     * only decides WHICH episode is selected.
     */
    const playerPath = 'src/components/AudioPlayer.jsx';
    t('the radio has a real transport component', existsSync(playerPath));

    if (existsSync(playerPath)) {
      const player = read(playerPath);
      /*
       * Comments stripped before matching. The header of that file explains
       * the design in prose that necessarily names `timeupdate`, `preload`
       * and the seek bar — matching the explanation instead of the code is
       * the single trap this suite has fallen into most often.
       */
      const playerCode = player.replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
        .replace(/^\s*\/\/.*$/gm, '');

      /* One shared element. Per-row <audio> lets a user start four episodes
         at once with no obvious way to stop them. */
      t('...built on a single shared <audio> element', /new Audio\(\)/.test(playerCode));
      /*
       * `metadata`, not `auto`. `auto` pulls the whole episode the moment a
       * src is set — tens of megabytes on a metered connection for something
       * the user may not play. `none` would be wrong too: it leaves the
       * duration unknown, so the scrub bar has no scale.
       */
      t('...that preloads metadata only, never the whole file',
        /preload = 'metadata'/.test(playerCode));

      /* The controls the report actually asked for, each pinned to the
         mechanism rather than to a label that could exist without it. */
      t('...it can seek', /currentTime\s*=/.test(playerCode) && /type="range"/.test(playerCode));
      t('...it shows elapsed and total time', /fmtDuration/.test(playerCode));
      t('...it can change speed', /playbackRate/.test(playerCode));
      t('...it can skip between episodes',
        /onTrack\?\.\(next\)/.test(playerCode) && /onTrack\?\.\(prev\)/.test(playerCode));
      t('...and it can be stopped from anywhere on the page',
        /onClose/.test(playerCode) && /position: fixed/.test(read('src/index.css')));

      /*
       * Progress is driven by requestAnimationFrame, and the loop MUST be
       * cancelled on pause and unmount. A leaked rAF loop over a paused
       * element is a battery drain nobody can see.
       */
      t('...progress is animation-frame driven',
        /requestAnimationFrame/.test(playerCode));
      t('...and the loop is cancelled, not leaked',
        (playerCode.match(/cancelAnimationFrame/g) ?? []).length >= 3);

      /* A failed load must clear the playing state, or the row stays stuck
         looking pressed over silence. */
      t('...a failed load is reported rather than swallowed',
        /setFailed\(true\)/.test(playerCode) && hasKey(JSON.parse(read('src/i18n/locales/en.json')), 'radio.failed'));

      /*
       * ─── BOTH THEMES ────────────────────────────────────────────────────
       * Every colour must be a token. One hard-coded hex is a hole in the
       * light theme that nobody notices until a user opens it, which is
       * exactly what «در دو تم هم پویا باشد» is asking to prevent.
       *
       * Checked on the JSX, where a stray colour would live; the CSS block
       * is allowed hex values inside rgba() shadows and tints, which are
       * theme-specific by nature and are overridden explicitly below.
       */
      const hexInJsx = playerCode.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
      t(`...the player hard-codes no colours${hexInJsx.length ? ` — found ${hexInJsx.join(', ')}` : ''}`,
        hexInJsx.length === 0);

      const css = read('src/index.css');
      t('...it is styled', /\.ap-seek/.test(css) && /\.ap-play/.test(css));
      t('...and the light theme is handled explicitly',
        /:root\[data-theme='light'\] \.ap\b/.test(css));

      /* Lock-screen controls. News radio is listened to with the screen off
         by definition, so this is not a nicety. */
      t('...and it drives the phone lock-screen controls',
        /mediaSession/.test(playerCode) && /setActionHandler/.test(playerCode));
    }

    /*
     * ─── SPEED ────────────────────────────────────────────────────────────
     *   «سرعت اومدن زیاد شود»
     *
     * Two causes, two fixes, and both must hold or the tab is slow again:
     *   1. the route was memory-cached only, so every Vercel cold start
     *      re-fetched four RSS documents;
     *   2. it waited for the SLOWEST feed with the shared 12-second timeout.
     */
    t('the audio route survives a cold start',
      /withPersistentCache\(\s*'audio'/.test(app.replace(/\/\*[\s\S]*?\*\//g, '')));
    t('...and one slow podcast host cannot hold the tab hostage',
      /AUDIO_TIMEOUT_MS/.test(srvCode) && !/UPSTREAM_TIMEOUT_MS/.test(srvCode));
    t('...while a dead station still leaves the dial playing',
      /allSettled/.test(srvCode));

    /* Attribution is not optional: these are other people's shows. */
    const en = JSON.parse(read('src/i18n/locales/en.json'));
    const fa = JSON.parse(read('src/i18n/locales/fa.json'));
    const ar = JSON.parse(read('src/i18n/locales/ar.json'));
    t('every episode is credited to its show', /stationName/.test(panelCode));
    t('...and the section says nothing is rehosted', hasKey(en, 'radio.credit'));
    t('...in all three written languages',
      hasKey(fa, 'radio.credit') && hasKey(ar, 'radio.credit'));

    const keys = [...panel.matchAll(/t\('(radio\.[a-zA-Z0-9_.]+)'/g)].map((m) => m[1]);
    const missing = [...new Set(keys)].filter((k) => !hasKey(en, k));
    t(`every radio.* key resolves (${new Set(keys).size} checked)` +
      (missing.length ? ` — missing: ${missing.join(', ')}` : ''), missing.length === 0);
    t('...and all are translated',
      [...new Set(keys)].every((k) => hasKey(fa, k) && hasKey(ar, k)));
  }

  /* ---- 64. collapsible warnings, dark default, nav geometry, IndexNow --- */
  {
    const enL = JSON.parse(read('src/i18n/locales/en.json'));
    const faL = JSON.parse(read('src/i18n/locales/fa.json'));

    /*
     * ═══════════════════════════════════════════════════════════════════════
     * WARNINGS IN COLLAPSIBLE BOXES.
     * ═══════════════════════════════════════════════════════════════════════
     *   «کلا هشدارها بهم نریخته باشد و داخل یک جعبه باز شونده باشد بهتر است»
     *
     * Counted before the change: Wallet 8 `.notice` blocks, SolanaSwap 8,
     * Stocks 5, Signals 4. A column of amber boxes is how safety copy stops
     * being read — when every third block is a warning, none of them is.
     *
     * The rule enforced here is the one that keeps this safe: `.notice` stays
     * for anything about to cost money on THIS tap; InfoBox takes the
     * explanations and the policy restatements.
     */
    t('the collapsible box exists', existsSync('src/components/InfoBox.jsx'));

    const perp = read('src/pages/Perp.jsx');
    t('the futures explainer is in a box', /InfoBox/.test(perp) && /perp\.how\.title/.test(perp));
    /*
     * The leverage risk notice must NOT be folded. It describes what the
     * button does to the user's money, which is exactly the category that
     * stays inline.
     */
    t('...but the leverage risk stays inline',
      /className="notice notice-danger">\{t\('perp\.riskNotice'\)\}/.test(perp));

    const stocks = read('src/pages/Stocks.jsx');
    t('the stocks explainer is in a box', /stocks\.beforeBuy\.title/.test(stocks));
    /*
     * ─── THIS USED TO ASSERT `defaultOpen`, AND NOW ASSERTS THE OPPOSITE ────
     * The old rule was mine and it was defensible: someone who believes a
     * tokenised share IS a share has misunderstood what they own.
     *
     * The owner overruled it — «هشدار را در صفحه باز شونده بزار» — and the
     * safety property moved rather than disappeared. It is now carried by the
     * TITLE, which names the risk instead of saying "read this before you
     * buy", so the fold hides detail and not the fact. Section 98 asserts the
     * titles; this one just confirms the box exists.
     */
    t('...and the explainer is collapsible', /id="stocks-before"/.test(stocks));
    t('...and it still says these are not shares', /stocks\.notShares/.test(stocks));

    /* The three screens the owner named by location. */
    t('the wallet custody line is folded', /wallet\.custodyTitle/.test(read('src/pages/Wallet.jsx')));
    t('the earn risk block is folded', /earn\.riskTitle/.test(read('src/pages/Earn.jsx')));
    const sol = read('src/pages/SolanaSwap.jsx');
    t('the two stacked solana notices became one box', /solana\.aboutTitle/.test(sol));

    const boxKeys = ['perp.how.title', 'perp.venuesTitle', 'stocks.beforeBuy.title',
      'stocks.kycTitle', 'wallet.custodyTitle', 'farm.custodyTitle', 'earn.riskTitle',
      'solana.aboutTitle'];
    const missingBox = boxKeys.filter((k) => !hasKey(enL, k) || !hasKey(faL, k));
    t(`every box title is translated${missingBox.length ? ` — missing: ${missingBox.join(', ')}` : ''}`,
      missingBox.length === 0);

    /*
     * ─── DARK IS THE DEFAULT, AND THE BOOT SCREEN MUST AGREE ────────────────
     * «تم مشکی هم تم دیفالت باشد»
     *
     * These two values are coupled. The boot overlay paints before React
     * exists, so if the store says dark and the HTML says light, every fresh
     * install shows one white frame and snaps to black — which reads as a
     * rendering fault rather than a theme. Asserted together for that reason.
     */
    const store = read('src/store/useSettingsStore.js')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    t('the default theme is dark', /theme: 'dark'/.test(store));

    const html = read('index.html');
    t('...the boot canvas is dark too', /html, body \{ background: #000;/.test(html));
    t('...the theme-color meta matches', /content="#000000"/.test(html));
    /*
     * The pre-paint script must override for an EXPLICIT light choice only.
     * Treating `null` (a fresh install) as light is what would make new users
     * flash — the exact bug this mirrors, in the other direction.
     */
    t('...and only an explicit light choice overrides it',
      /theme === 'light'/.test(html) && !/if \(theme === 'dark'\) \{\s*document/.test(html));

    /*
     * ─── THE CENTRE BUTTON MUST FILL THE NOTCH ──────────────────────────────
     * «دایره وسط منو ... به اندازه همون حفره باشد ... و حفره را پر کند»
     *
     * The hollow is 2 × --notch-r. The circle must nearly fill it, leaving a
     * small ring — flush to the edge would overlap the mask's 1.5px feather
     * and shimmer as the bar animates.
     *
     * Was 62px hollow against a 42px circle: ten pixels of empty bar visible
     * all the way round, which reads as a small button in an oversized hole.
     */
    const css = read('src/index.css');
    const notchR = Number(/--notch-r:\s*(\d+)px/.exec(css)?.[1]);
    const dropW = Number(/\.nav-centre \{[\s\S]*?width:\s*(\d+)px/.exec(css)?.[1]);
    const ring = (notchR * 2 - dropW) / 2;
    t(`the centre button fills the notch (hollow ${notchR * 2}px, circle ${dropW}px, ring ${ring}px)`,
      Number.isFinite(ring) && ring > 0 && ring <= 5);
    /*
     * And it must be CENTRED in it. The notch is cut at the bar's top edge,
     * 14 + 64 = 78px up, so the circle's centre must also sit at 78:
     * bottom = 78 - diameter/2. Getting this wrong sinks the button into the
     * bar, which is the "merged into the menu" look reported before.
     */
    const bottom = Number(/\.nav-centre \{[\s\S]*?bottom:\s*calc\((\d+)px/.exec(css)?.[1]);
    t(`...and is centred in it (bottom ${bottom}px puts its centre at ${bottom + dropW / 2})`,
      bottom + dropW / 2 === 78);
    t('...and keeps a comfortable tap target', dropW >= 44);

    /*
     * ─── INDEXNOW: TELLING SEARCH ENGINES THE NEW DOMAIN EXISTS ─────────────
     * «سایت جدید را وارد موتور جستجو کن»
     *
     * Ownership is proven by hosting a key file at the site root. If the
     * constant in the script and the filename in public/ ever disagree, every
     * submission silently 403s — so they are asserted to match rather than
     * assumed.
     */
    const sub = read('scripts/submit-indexnow.mjs');
    const key = /const KEY = '([a-f0-9]{32})'/.exec(sub)?.[1];
    t('the IndexNow submitter exists', Boolean(key));
    t('...and the key file is published at the site root',
      Boolean(key) && existsSync(`public/${key}.txt`));
    /*
     * `read()` throws when the file is absent, which would abort the whole
     * suite instead of failing one check — so the existence test has to gate
     * the content test. A check that crashes the runner tells you far less
     * than one that fails.
     */
    t('...containing exactly the key',
      Boolean(key) && existsSync(`public/${key}.txt`) &&
      read(`public/${key}.txt`).trim() === key);
    t('...for the new domain, not the old one',
      /fbtswap\.ir/.test(sub) && !/lawpoetics/.test(sub));

    /*
     * ─── THE KEY IS ALSO SERVED BY THE API, AND HERE IS WHY ─────────────────
     * Vercel's CDN kept returning 404 for the newly added
     * public/<key>.txt long after the deploy that added it, while older
     * static files served normally. A keyLocation that 404s means every
     * submission is rejected 403 — silently, forever, with no error anywhere
     * we would see it.
     *
     * Bing's docs allow a key file "in other locations within the same host"
     * provided keyLocation names it. /api/* is a serverless function rather
     * than a cached static asset, so it is live the moment the function
     * deploys.
     *
     * All THREE copies must agree: the constant in the script, the constant
     * in the server, and the static file. Any disagreement is an
     * unrecoverable 403.
     */
    const appSrc = read('server/app.js');
    const srvKey = /const INDEXNOW_KEY = '([a-f0-9]{32})'/.exec(appSrc)?.[1];
    t('the API also serves the ownership key', Boolean(srvKey));
    t('...and every copy of the key agrees', srvKey === key);
    t('...and the submitter points keyLocation at the API route',
      /api\/indexnow-key\//.test(sub));

    /*
     * ─── IT MUST RUN AUTOMATICALLY, NOT WHEN SOMEONE REMEMBERS ──────────────
     * Chained onto build:full, which is what Vercel runs. A manual step after
     * every deploy is a step that stops happening by the third deploy — and
     * the owner works from a phone and cannot run node scripts at all, so
     * "run it by hand" was never a real plan.
     */
    const pkg = JSON.parse(read('package.json'));
    t('the submitter runs on every production build',
      /submit-indexnow/.test(pkg.scripts['build:full'] ?? ''));

    /*
     * And it must never be able to fail one. An SEO nicety blocking a working
     * release would be a far worse bug than the pages going unannounced, so
     * every failure path in the script exits 0.
     */
    t('...and can never fail the build', !/process\.exit\(1\)/.test(sub));

    /*
     * The submitted list must match the pages actually generated. A landing
     * page added to gen-landing.mjs and forgotten here is a page no engine is
     * ever told about.
     */
    const gen = read('scripts/gen-landing.mjs');
    const genSlugs = [...gen.matchAll(/slug: '([^']+)'/g)].map((m) => m[1]);
    const subSlugs = [...sub.matchAll(/^\s*'([^']+)'/gm)].map((m) => m[1]).filter(Boolean);
    const unsubmitted = genSlugs.filter((g) => !subSlugs.includes(g));
    t(`every generated landing page is submitted${unsubmitted.length ? ` — missing: ${unsubmitted.join(', ')}` : ''}`,
      unsubmitted.length === 0);

    /*
     * ─── THE VERDICT COPY MUST NOT SOUND LIKE WEATHER ───────────────────────
     * «مثلا یعنی چی باد میوزد جالب نیست لحن رسمی و کاربلد داشته باشد»
     *
     * "The wind is behind this one" replaced a measurable statement with a
     * metaphor that has no units, translated as a literal calque into
     * Persian, and read as marketing rather than analysis.
     */
    t('the wind metaphor is gone from English',
      !/wind is (behind|against)/i.test(JSON.stringify(enL.verdict)));
    t('...and from Persian', !/باد پشت سر|باد روبه/.test(JSON.stringify(faL.verdict)));
    /* And what replaced it must be concrete, not merely different. */
    t('...replaced by something measurable',
      /four readings/i.test(enL.verdict.plain.tailwind) &&
      /چهار خوانش/.test(faL.verdict.plain.tailwind));
    /* The two horizons the owner asked to see named. */
    t('the weekly and monthly views are labelled',
      /Weekly/.test(enL.verdict.short) && /هفتگی/.test(faL.verdict.short) &&
      /Monthly/.test(enL.verdict.long) && /ماهانه/.test(faL.verdict.long));

    /* The business page carries the canonical domain — partners read it, and
       knowing the one real domain is how a clone gets recognised. */
    const biz = read('src/pages/Business.jsx');
    t('the business page shows the website', /biz\.website/.test(biz));
    t('...resolved rather than hard-coded', /publicAppUrl/.test(biz));
  }

  /* ---- 63. our own vault: dormant by default, wired when it is real ----- */
  {
    /*
     * ═══════════════════════════════════════════════════════════════════════
     * BUILT NOW, SWITCHED ON LATER — WITHOUT ADVERTISING A PRODUCT THAT IS
     * NOT THERE.
     * ═══════════════════════════════════════════════════════════════════════
     *   «بعنوان یک اپشن بعدا که اعتماد سازی بیشتر شد ... اما از الان باشد»
     *
     * Two opposite failures to prevent at once, which is why this section
     * checks both directions:
     *
     *   • Ship the surface with no vault behind it, and a user is pointed
     *     toward depositing real money into an address that is empty or
     *     wrong. Unrecoverable, and the worst outcome this app can produce.
     *
     *   • Ship the vault with no surface, and it earns nothing — the exact
     *     "wired to nothing" shape already shipped on the bridge, the gasless
     *     swap and the fiat integration.
     *
     * So: the full chain must exist, AND the default state must render
     * nothing.
     */
    const lib = read('src/lib/vault.js');
    const libCode = lib.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const card = read('src/components/VaultCard.jsx');
    const earn = read('src/pages/Earn.jsx');

    /* The chain: module -> component -> page imports it -> page RENDERS it. */
    t('the vault module exists', existsSync('src/lib/vault.js'));
    t('...the card component exists', existsSync('src/components/VaultCard.jsx'));
    t('...the card reads the config', /vaultConfig/.test(card));
    t('...the Earn page imports the card', /import VaultCard/.test(earn));
    t('...and actually renders it', /<VaultCard/.test(earn));

    /*
     * THE SAFETY PROPERTY. `vaultConfig` must return null — never a partial
     * object — when the address is missing or malformed, and the card must
     * return null on that. Checked in the source because the built default
     * has no address configured, so a runtime check would pass trivially.
     */
    t('a malformed address yields no config', /isValidVaultAddress/.test(libCode));
    t('...an unknown chain yields no config too', /VAULT_CHAINS\[VAULT_CHAIN\]/.test(libCode));
    t('...and the card renders nothing without one', /if \(!vault\) return null/.test(card));

    /*
     * The address is public by design and correctly VITE_-prefixed, exactly
     * like the GMX referral code. What must NEVER appear is a private key or
     * a seed anywhere near this module.
     */
    t('the vault address is a public identifier', /VITE_FBT_VAULT_ADDRESS/.test(libCode));
    t('...and no secret is read here',
      !/PRIVATE_KEY|MNEMONIC|SEED_PHRASE/i.test(libCode));

    /*
     * ─── DISCLOSURE IS NOT OPTIONAL ─────────────────────────────────────────
     * We take a cut of the yield and we choose which markets the money enters.
     * Both facts must be on the card itself, before the button — a fee found
     * after depositing is the kind that makes someone distrust every other
     * number in the app.
     */
    t('the fee is disclosed on the card', /vault\.feePill/.test(card));
    t('...and the risk we introduce is stated', /vault\.risk/.test(card));
    t('...before the deposit button, not after',
      card.indexOf('vault.risk') < card.indexOf('vault.open'));

    /*
     * The user must be able to verify the contract independently. A vault
     * they can only take on faith defeats the point of non-custody.
     */
    t('the contract is verifiable on an explorer', /explorerUrl/.test(libCode));
    t('...and the card offers that link', /vault\.verify/.test(card));

    const en = JSON.parse(read('src/i18n/locales/en.json'));
    const fa = JSON.parse(read('src/i18n/locales/fa.json'));
    const ar = JSON.parse(read('src/i18n/locales/ar.json'));
    const keys = [...card.matchAll(/t\('(vault\.[a-zA-Z0-9_.]+)'/g)].map((m) => m[1]);
    const missing = [...new Set(keys)].filter((k) => !hasKey(en, k));
    t(`every vault.* key resolves (${new Set(keys).size} checked)` +
      (missing.length ? ` — missing: ${missing.join(', ')}` : ''), missing.length === 0);
    t('...and all are translated',
      [...new Set(keys)].every((k) => hasKey(fa, k) && hasKey(ar, k)));
    /*
     * The risk sentence must survive translation. Softening it in one language
     * would leave Persian or Arabic readers with a sales pitch where English
     * readers get a warning.
     */
    t('the risk copy names bad debt in every language',
      /bad debt/i.test(en.vault.risk) && /بدهی بد/.test(fa.vault.risk) &&
      /ديون/.test(ar.vault.risk));
  }

  /* ---- 62a. repeat visits must not re-download the whole app ------------ */
  {
    /*
     * ═══════════════════════════════════════════════════════════════════════
     * THE SLOWNESS THE OWNER REPORTED, AND WHAT ACTUALLY CAUSED IT.
     * ═══════════════════════════════════════════════════════════════════════
     *     «سرعت لود سایت خیلی کم شده و طول میکشه بیاد»
     *
     * Measured rather than guessed. First paint pulls roughly 770 KB
     * uncompressed: a 242 KB entry bundle, React at 150 KB, framer-motion at
     * 132 KB, the 109 KB Persian variable font, 86 KB of CSS and 51 KB of
     * i18n runtime. That is the unavoidable cost of the FIRST visit.
     *
     * It was also the cost of every visit after it. `express.static` was
     * configured with a flat `maxAge: '1h'` and vercel.json set no headers at
     * all, so a user returning the next day re-downloaded all of it. On a
     * congested Iranian mobile connection that is most of the wait, and it is
     * pure waste: those files had not changed.
     *
     * The fix depends on a property of the filenames, which is why it is safe
     * and why it must be checked rather than assumed. Vite writes a content
     * hash into every asset name, so the URL changes whenever the bytes
     * change and a stale file can never be served.
     */
    const vj = JSON.parse(read('vercel.json'));
    const headers = vj.headers ?? [];

    /*
     * ═══════════════════════════════════════════════════════════════════════
     * vercel.json MUST CONTAIN NO UNKNOWN KEYS — INCLUDING "//" COMMENTS.
     * ═══════════════════════════════════════════════════════════════════════
     * This check exists because its absence cost SEVEN CONSECUTIVE FAILED
     * DEPLOYMENTS and roughly two hours of work that never reached the site.
     *
     * When the cache headers were added I annotated each rule the way
     * everything else in this repo is annotated. JSON has no comments, so I
     * used the common `"//": "..."` trick — which works in package.json and
     * in most tooling.
     *
     * It does not work here. Vercel's published schema, named in this file's
     * own $schema line, declares `additionalProperties: false`. Any key
     * outside the documented set makes the file invalid, and the build fails
     * before it starts.
     *
     * ─── WHY NOTHING ELSE CAUGHT IT ─────────────────────────────────────────
     * Both existing safety layers were blind to it:
     *
     *   • 1914 tests — none of them read vercel.json as a schema
     *   • `vite build` — never reads vercel.json at all
     *
     * So every local signal was green: build passed, tests passed, push
     * succeeded, main fast-forwarded. Only the live site disagreed, and I
     * spent twenty minutes attributing that to CDN propagation and even
     * built a workaround, which also did not deploy, for the same reason.
     *
     * The lesson is narrow and worth keeping: if the toolchain cannot see a
     * class of error, that error will happen again. Hence this check.
     */
    const ALLOWED_TOP = new Set([
      '$schema', 'buildCommand', 'outputDirectory', 'framework', 'devCommand',
      'installCommand', 'ignoreCommand', 'rewrites', 'redirects', 'headers',
      'cleanUrls', 'trailingSlash', 'functions', 'crons', 'regions', 'images',
      'public', 'git', 'github'
    ]);
    const strayTop = Object.keys(vj).filter((k) => !ALLOWED_TOP.has(k));
    t(`vercel.json has no unknown top-level keys${strayTop.length ? ` — ${strayTop.join(', ')}` : ''}`,
      strayTop.length === 0);

    /*
     * The rule objects, where the actual mistake was. A header rule accepts
     * exactly `source`, `headers` and optionally `has`/`missing`. Anything
     * else — a "//" comment above all — invalidates the whole file.
     */
    const strayRule = [];
    for (const h of headers) {
      for (const k of Object.keys(h)) {
        if (!['source', 'headers', 'has', 'missing'].includes(k)) {
          strayRule.push(`${h.source ?? '?'}:${k}`);
        }
      }
      for (const kv of h.headers ?? []) {
        for (const k of Object.keys(kv)) {
          if (!['key', 'value'].includes(k)) strayRule.push(`${h.source ?? '?'}:header:${k}`);
        }
      }
    }
    t(`no header rule carries an unknown key${strayRule.length ? ` — ${strayRule.join(', ')}` : ''}`,
      strayRule.length === 0);

    /* Same for rewrites, which are the other place a comment would look
       natural and would break the deploy identically. */
    const strayRw = (vj.rewrites ?? []).flatMap((r) =>
      Object.keys(r).filter((k) => !['source', 'destination', 'has', 'missing'].includes(k))
    );
    t(`no rewrite carries an unknown key${strayRw.length ? ` — ${strayRw.join(', ')}` : ''}`,
      strayRw.length === 0);

    /*
     * And the documentation of the rule, so the next person meets the reason
     * before they meet the failure.
     */
    t('the no-comments rule is written down', existsSync('docs/VERCEL-JSON-RULES.md'));
    const forSource = (re) => headers.find((h) => re.test(h.source));

    const assets = forSource(/assets/);
    t('vercel caches hashed assets', Boolean(assets));
    t('...for a long time, and immutably',
      /max-age=31536000/.test(assets?.headers?.[0]?.value ?? '') &&
      /immutable/.test(assets?.headers?.[0]?.value ?? ''));

    const fonts = forSource(/fonts/);
    t('...and the fonts too', /max-age=31536000/.test(fonts?.headers?.[0]?.value ?? ''));

    /*
     * The counterpart, and the one that makes the year safe. index.html names
     * the current hashed URLs; caching it pins a returning visitor to the
     * PREVIOUS deploy's JavaScript while its assets sit in cache for a year.
     * That is how somebody stays on a broken build for hours after the fix
     * ships -- strictly worse than a slow load.
     */
    const root = headers.find((h) => h.source === '/');
    t('index.html is revalidated every time',
      /max-age=0/.test(root?.headers?.[0]?.value ?? '') &&
      /must-revalidate/.test(root?.headers?.[0]?.value ?? ''));

    /*
     * The service worker, for the same reason and more urgently: a cached
     * sw.js keeps serving its own cached shell long after index.html moved on.
     */
    const sw = headers.find((h) => h.source === '/sw.js');
    t('...and so is the service worker', /max-age=0/.test(sw?.headers?.[0]?.value ?? ''));

    /*
     * The Express path must agree. Vercel serves /assets from its edge and
     * never reaches server/app.js, but the APK bundles this server and so
     * does anyone self-hosting. Two hosts disagreeing about cache lifetime is
     * a bug that only appears on one of them, which is the hardest kind to
     * find.
     */
    /*
     * Comments stripped FIRST. The note above explaining the fix quotes the
     * old `maxAge: '1h'` verbatim, so an un-stripped check fails on its own
     * documentation. That is the fourth time this suite has hit that exact
     * trap (SECRETS in venueReferral.js, Aparat in Docs.jsx, audio/ in
     * server/audio.js) -- strip before matching, always.
     */
    const srv = read('server/app.js')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    t('the Express static handler agrees with the edge',
      /max-age=31536000, immutable/.test(srv));
    t('...and never caches index.html either',
      /max-age=0, must-revalidate/.test(srv));
    t('the old flat one-hour rule is gone', !/maxAge: '1h'/.test(srv));

    /*
     * ─── AND THE FIRST VISIT MUST NOT GROW UNNOTICED ────────────────────────
     * Caching fixes repeat visits; it does nothing for the first one. This
     * guards the entry payload against quietly gaining a heavy dependency --
     * the usual way a fast app becomes a slow one is one eager import at a
     * time, each defensible on its own.
     *
     * Only meaningful after a build, so it is skipped when dist is absent
     * rather than failing and teaching people to ignore it.
     */
    if (existsSync('dist/index.html')) {
      const html = read('dist/index.html');
      const refs = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
      let bytes = 0;
      for (const r of refs) {
        const f = `dist${r}`;
        if (existsSync(f)) bytes += read(f).length;
      }
      const kb = Math.round(bytes / 1024);
      /*
       * 1100 KB, against roughly 660 KB of JS+CSS measured today. Deliberately
       * loose: this is a ratchet against a step change (someone making a
       * wallet SDK or a chart library eager), not a budget to micro-manage.
       * A limit set too tight gets raised on every failure until it means
       * nothing.
       */
      t(`the first-paint bundle stays under 1100 KB (currently ${kb} KB)`, kb < 1100);
    }
  }

  /* ---- 62b. no screen leads with a single-country restriction ----------- */
  {
    /*
     * ═══════════════════════════════════════════════════════════════════════
     * A GENERAL RULE, NOT A PATCH FOR ONE STRING.
     * ═══════════════════════════════════════════════════════════════════════
     * `fiat.cardNotice` was rendered unconditionally on the Buy screen and
     * told every user in the world about Iranian bank cards. Fixing that one
     * string fixes one string; the same mistake is easy to make again the
     * next time a jurisdiction rule needs stating somewhere.
     *
     *     «ما از همه جهان مشتری داریم نه فقط ایران»
     *     «محدودیت روی اپ و سایت نزار»
     *
     * So the rule is enforced structurally: a country may be named in copy
     * that a reader CHOSE to open (the Restrictions sheet), in legal and risk
     * disclosures, in help answers someone searched for, and in a news
     * category label. It may NOT appear in the always-visible body of a
     * primary screen, where it is noise to almost everyone and makes the app
     * itself look geofenced.
     *
     * The allow-list is explicit rather than a pattern, because "which
     * screens may name a country" is a judgement that should be visible in
     * the diff when someone changes it.
     */
    const PRIMARY_SCREENS = [
      'src/pages/Swap.jsx',
      'src/pages/Buy.jsx',
      'src/pages/Market.jsx',
      'src/pages/Wallet.jsx',
      'src/pages/Orders.jsx',
      'src/pages/Earn.jsx',
      'src/pages/News.jsx',
      'src/pages/Signals.jsx',
      'src/pages/Bridge.jsx',
      'src/pages/SolanaSwap.jsx',
      'src/components/FiatPanel.jsx'
    ];

    const en = JSON.parse(read('src/i18n/locales/en.json'));
    const fa = JSON.parse(read('src/i18n/locales/fa.json'));
    const get = (o, path) => path.split('.').reduce((a, k) => (a == null ? a : a[k]), o);

    /*
     * Comments are stripped before the keys are harvested. The notes above
     * name Iran repeatedly, and an un-stripped scan would flag this file's
     * own documentation — a trap this suite has fallen into three times now
     * (SECRETS in venueReferral.js, Aparat in Docs.jsx).
     */
    /* Local, because the other `code` helpers in this file are block-scoped
       to their own sections. Strips block comments, line comments and JSX
       comment expressions. */
    const strip3 = (src) => src
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    const offenders = [];
    for (const f of PRIMARY_SCREENS) {
      if (!existsSync(f)) continue;
      const src = strip3(read(f));
      for (const m of src.matchAll(/t\('([a-zA-Z0-9_.]+)'/g)) {
        const key = m[1];
        for (const [lang, loc] of [['en', en], ['fa', fa]]) {
          const v = get(loc, key);
          if (typeof v !== 'string') continue;
          if (/\bIran\b|ایران|إيران|OFAC/i.test(v)) offenders.push(`${f}:${key} (${lang})`);
        }
      }
    }
    t(`no primary screen names a single country in always-visible copy` +
      (offenders.length ? ` — ${[...new Set(offenders)].join(', ')}` : ''),
      offenders.length === 0);

    /*
     * The counterpart, and the reason the rule above is safe: the facts must
     * still be somewhere a user can find them. Removing a real restriction to
     * tidy a screen would send somebody to enter card details that cannot be
     * authorised, which is worse than an irrelevant paragraph.
     */
    t('...but the facts are still reachable in the restrictions sheet',
      hasKey(en, 'restrict.region.iran.note') && hasKey(en, 'restrict.cards'));
    t('...and in the help answers, for anyone who searches',
      /iranLegal/.test(read('src/lib/faqLocal.js')));

    /*
     * ─── AND NOTHING IN THE APP ACTUALLY BLOCKS ANYONE ──────────────────────
     * The warnings were always about third parties, never about us. This
     * pins that: no IP geolocation, no country allow-list, no region gate
     * anywhere in our own code. If someone ever adds one, this fails.
     */
    const scan = ['server/app.js', 'server/fiat.js', 'src/App.jsx', 'src/lib/features.js']
      .filter((f) => existsSync(f))
      .map((f) => strip3(read(f)))
      .join('\n');
    t('the app geolocates nobody',
      !/geoip|geolocat|cf-ipcountry|x-vercel-ip-country|countryCode\s*[!=]==/i.test(scan));
    t('...and blocks no region', !/blockedCountries|allowedCountries|regionGate/i.test(scan));
  }

  /* ---- 62. the domain move must be complete ----------------------------- */
  {
    /*
     * ─── A HALF-MOVED DOMAIN IS WORSE THAN NOT MOVING ───────────────────────
     * The site moved from www.lawpoetics.ir to fbtswap.ir. Every place the
     * old host survives is a specific, silent failure rather than an
     * inconsistency:
     *
     *   • A canonical tag on the old host tells Google to index a domain we
     *     are no longer promoting, and the new one never ranks.
     *   • robots.txt naming a sitemap outside the submitted property makes
     *     Search Console discard the whole submission.
     *   • `publicAppUrl` is what every referral invite and share link
     *     resolves to inside the APK, where window.location is
     *     https://localhost. Stale, and every invite ever generated points at
     *     the wrong place.
     *
     * Comments are stripped before matching, because the notes explaining the
     * move necessarily mention the old name.
     */
    const strip2 = (src) => src
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/#.*$/gm, '')
      .replace(/^\s*\/\/.*$/gm, '');

    const files = [
      'index.html',
      'public/robots.txt',
      'public/sitemap.xml',
      'src/lib/nativeShell.js',
      'src/context/WalletContext.jsx',
      'scripts/gen-landing.mjs'
    ];
    const stale = files.filter((f) => /lawpoetics/i.test(strip2(read(f))));
    t(`no file still points at the old domain${stale.length ? ` — ${stale.join(', ')}` : ''}`,
      stale.length === 0);

    const html = read('index.html');
    t('the canonical tag names the new domain',
      /<link rel="canonical" href="https:\/\/fbtswap\.ir\/"/.test(html));
    t('robots.txt points the sitemap at the new domain',
      /Sitemap: https:\/\/fbtswap\.ir\/sitemap\.xml/.test(read('public/robots.txt')));
    t('share and invite links resolve to the new domain',
      /fbtswap\.ir/.test(read('src/lib/nativeShell.js')));

    /*
     * ─── THE PERSIAN LANDING PAGE ───────────────────────────────────────────
     * The app is Persian-first on a .ir domain and every crawlable page was
     * in English, competing for phrases owned by Uniswap and MetaMask. The
     * Persian equivalents have a fraction of the competition and far more of
     * the people who would actually use this.
     */
    const gen = read('scripts/gen-landing.mjs');
    t('a Persian landing page is generated', /lang: 'fa'/.test(gen));
    t('...marked right-to-left', /dir: 'rtl'/.test(gen));
    t('...with the Persian font, not the system fallback', /Vazirmatn/.test(gen));

    /*
     * hreflang is ignored by Google unless the annotation is RECIPROCAL —
     * every page in the set points at every other INCLUDING itself. A one-way
     * link is silently dropped, which is the usual reason people conclude
     * hreflang does not work.
     */
    t('...and paired with its English twin by hreflang',
      /ALTERNATES/.test(gen) && /rel="alternate" hreflang=/.test(gen));

    /*
     * A non-ASCII slug MUST be percent-encoded in the sitemap. An unencoded
     * character makes the sitemap invalid per spec, and an invalid sitemap is
     * rejected whole — taking the English pages down with it.
     */
    t('non-ASCII slugs are percent-encoded for the sitemap',
      /encodeURIComponent\(p\.slug\)/.test(gen));
  }

  /* ---- 65. coin artwork: the right size, from one component ------------- */
  {
    /*
     * ═══════════════════════════════════════════════════════════════════════
     * WHY THE MARKET ICONS WERE SLOW.
     * ═══════════════════════════════════════════════════════════════════════
     *   «در قسمت بازار کویین ها ایکونشون نمیاد یا دیر و خیلی دیر میاد کنده»
     *
     * `normalizeCoin` stores CoinGecko's `image` verbatim, and that field is
     * always the LARGE variant — a 250x250 PNG, 25-60 KB. The market screen
     * renders 250 rows into 34px circles. So one visit asked for up to ~10 MB
     * of artwork it then scaled down by 86%, over ~6 parallel connections,
     * which is why they trickled in one at a time.
     *
     * These checks pin the fix at every layer, because a size rewrite applied
     * in ten of eleven call sites is not a fix — it is a bug that now happens
     * less often and is therefore harder to find.
     */
    /*
     * Comments stripped before every match. This suite has been fooled FOUR
     * separate times by a check that matched its own explanatory prose, so
     * the stripper is declared first in the block and used unconditionally.
     */
    const code = (src) => src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    t('the coin-image sizer exists', existsSync('src/lib/coinImage.js'));
    t('the shared coin avatar exists', existsSync('src/components/CoinLogo.jsx'));

    if (existsSync('src/lib/coinImage.js') && existsSync('src/components/CoinLogo.jsx')) {
      const sizer = code(read('src/lib/coinImage.js'));
      const logo = read('src/components/CoinLogo.jsx')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
        .replace(/^\s*\/\/.*$/gm, '');

      /*
       * Pinned to the literal path shape, not to the word "small". A check
       * for /small/ would pass for a module that returns the URL untouched
       * and merely mentions the word — the generic-match trap.
       */
      t('...it rewrites the CoinGecko size segment',
        sizer.includes('(thumb|small|large)') && sizer.includes('coins\\/images\\/'));
      t('...and leaves any other host alone',
        /\^https:/.test(sizer));

      /* The list default must be the SMALL variant. `large` here is the whole
         bug; `thumb` at 25px would be visibly soft on a 3x screen. */
      t("...and the list default is 'small'", /size = 'small'/.test(logo));

      /* The attributes that stop 250 rows from reflowing 250 times. */
      t('the avatar reserves its box before the bytes arrive',
        /loading="lazy"/.test(logo));
      t('...and never competes with the price data for connections',
        /fetchpriority="low"/.test(logo));
      t('...and leaks no browsing history to the image host',
        /referrerPolicy="no-referrer"/.test(logo));

      /*
       * A dead URL must fall back to LETTERS, not to an empty circle. The old
       * inline `{coin.image && <img>}` had no error handling at all, so a
       * 404 left a blank tile that reads as broken.
       */
      t('...and a failed image degrades to a readable monogram',
        /onError/.test(logo) && /coinHue/.test(logo));

      /*
       * ─── EVERY CALL SITE, OR THE FIX DOES NOT REACH THE SCREEN ──────────
       * The old expression was copy-pasted into eleven places. Any survivor
       * is a screen still pulling 250 KB images.
       */
      const screens = [
        'src/components/CoinRow.jsx',
        'src/pages/Market.jsx',
        'src/pages/CoinDetail.jsx',
        'src/pages/Trade.jsx',
        'src/pages/Signals.jsx',
        'src/pages/Stocks.jsx',
        'src/pages/Predict.jsx',
        'src/pages/Discover.jsx'
      ];
      const raw = screens.filter((f) => {
        if (!existsSync(f)) return false;
        const src = code(read(f));
        /* `<img src={...image}` in any shape — the pattern being eliminated. */
        return /<img[^>]*src=\{[^}]*\.image/.test(src);
      });
      t(`no screen still renders a raw coin <img>${raw.length ? ` — ${raw.join(', ')}` : ''}`,
        raw.length === 0);

      const notWired = screens.filter((f) => existsSync(f) && !/CoinLogo/.test(read(f)));
      t(`every coin screen uses the shared avatar${notWired.length ? ` — missing in ${notWired.join(', ')}` : ''}`,
        notWired.length === 0);

      /*
       * The connection to the image CDN must be warmed in the HTML, not after
       * the bundle parses. Otherwise the first icon still waits on DNS + TLS.
       */
      t('...and the image host is preconnected from the document head',
        /rel="preconnect" href="https:\/\/coin-images\.coingecko\.com"/.test(read('index.html')));
    }
  }

  /* ---- 66. "this coin cannot be swapped" was mostly false ---------------- */
  {
    /*
     * ═══════════════════════════════════════════════════════════════════════
     *   «بعضی از کویین ها مثل پنگوئن میگه نمیشه سواپ کرد»
     * ═══════════════════════════════════════════════════════════════════════
     * The coin page answered "can I trade this?" from the 46-entry curated
     * EVM table in chains.js. That table stopped being the answer the moment
     * the swap screen started loading thousands of tokens from public lists,
     * and it was never the answer for Solana — an entire screen of this app
     * that the coin page did not know existed.
     *
     * PENGU is the reported case: a Solana SPL token with deep Jupiter
     * liquidity, turned away from a trade we can execute and earn on.
     *
     * This is the "wired to nothing" class of failure, so the chain is
     * asserted end to end: module → route → route calls it → client lib →
     * page imports it → page CALLS it → page renders the result → the
     * destination screen can actually accept what the page hands it.
     */
    /*
     * Comments stripped before every match. This suite has been fooled FOUR
     * separate times by a check that matched its own explanatory prose, so
     * the stripper is declared first in the block and used unconditionally.
     */
    const code = (src) => src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    t('the venue resolver exists', existsSync('server/coinVenue.js'));

    if (existsSync('server/coinVenue.js')) {
      const venueSrc = code(read('server/coinVenue.js'));
      const appSrc = code(read('server/app.js'));

      t('...the route is mounted', /['"`]\/api\/coin-venue\/:id['"`]/.test(appSrc));
      t('...and the route calls the resolver', /resolveVenue\s*\(/.test(appSrc));
      t('...and the module is imported', /from '\.\/coinVenue\.js'/.test(appSrc));

      /*
       * Solana must be resolved as well as EVM, or the PENGU case is still
       * broken and the whole change is cosmetic.
       */
      t('...Solana is resolved, not just EVM', /SOLANA_SLUG/.test(venueSrc));
      /*
       * And it must be validated. An unvalidated mint becomes a `?toMint=`
       * link the Solana screen cannot resolve — a broken picker instead of
       * the honest "not here" the old code at least managed.
       */
      t('...and a malformed mint is rejected rather than forwarded',
        /1-9A-HJ-NP-Za-km-z/.test(venueSrc));

      /*
       * Solana must NOT be in PLATFORM_SLUGS. Every consumer of that object
       * does Number(key); a non-EVM entry gives NaN a chain and silently
       * corrupts the ORDER-FORM resolver, which is a different feature.
       */
      t('...and Solana is kept out of the EVM chain-id map',
        !/solana/i.test(code(read('server/coinIndex.js'))));
    }

    if (existsSync('src/lib/coinVenue.js')) {
      const libSrc = code(read('src/lib/coinVenue.js'));
      const detail = code(read('src/pages/CoinDetail.jsx'));

      t('the client library calls the route', /coin-venue\//.test(libSrc));
      /*
       * A network failure must return null, and null must NOT be rendered as
       * a refusal. Telling somebody their coin is untradeable because our own
       * request timed out is the same false negative this whole section
       * exists to remove.
       */
      t('...a failure is null, never a false "not tradeable"',
        /catch\s*\{\s*return null;/.test(libSrc));
      t('...and a failure is not cached',
        libSrc.indexOf('memo.set') < libSrc.indexOf('catch {'));

      t('the coin page asks', /getCoinVenue/.test(detail));
      t('...and renders the result', /resolvedRoute/.test(detail));
      /*
       * The "not swappable" message must be gated on the answer having
       * ARRIVED. Rendering it while the request is in flight is a refusal
       * that flickers into a Buy button a second later — the user has
       * already read it and moved on.
       */
      /*
       * Pinned to the RENDER GATE, not to the identifier. `venueChecked`
       * appears in the effect that sets it, so a bare /venueChecked/ passes
       * for a page that computes the flag and then ignores it — the generic
       * match that succeeds for both the right and the wrong implementation.
       */
      t('...and never says "not swappable" before the answer arrives',
        /:\s*!venueChecked\s*\?/.test(detail) &&
        detail.indexOf('!venueChecked') < detail.indexOf('coin.notSwappable'));

      /*
       * ─── THE DESTINATION HAS TO ACCEPT THE HANDOFF ──────────────────────
       * This is precisely where this repo has shipped "wired to nothing"
       * three times: a link that is generated but that the target screen
       * ignores. Both receivers are checked.
       */
      const swap = code(read('src/pages/Swap.jsx'));
      t('the EVM swap screen accepts a contract address',
        /searchParams\.get\('toAddress'\)/.test(swap));
      t('...and imports it when no list has it',
        /importTokenByAddress/.test(swap));
      /*
       * `?to=` is a SYMBOL and must stay matched against the curated list
       * only — a symbol from a URL selecting an arbitrary token is a one-tap
       * phishing vector. The address path is separate precisely so that
       * guarantee survives.
       */
      t('...while the symbol parameter stays restricted to curated tokens',
        /const pick = \(sym\) => curated\.find/.test(swap));

      const sol = code(read('src/pages/SolanaSwap.jsx'));
      t('the Solana screen accepts a resolved mint',
        /searchParams\.get\('toMint'\)/.test(sol));
      t('...and validates it before selecting anything',
        /isSolanaAddress\(mint\)/.test(sol));
      t('...while ?to= stays restricted to the curated assets',
        /findAsset\(to\)/.test(sol));

      /* The copy has to exist in all three written languages or the page
         renders a raw key where the reassurance should be. */
      const enL = JSON.parse(read('src/i18n/locales/en.json'));
      const faL = JSON.parse(read('src/i18n/locales/fa.json'));
      const arL = JSON.parse(read('src/i18n/locales/ar.json'));
      for (const k of ['coin.resolvedEvmNote', 'coin.resolvedSolanaNote']) {
        t(`${k} is translated everywhere`,
          hasKey(enL, k) && hasKey(faL, k) && hasKey(arL, k));
      }
      /*
       * And it must SAY the token is unverified. A resolved token is not a
       * curated one; presenting it with the same confidence would spend the
       * trust the curated list was built to earn.
       */
      t('...and the resolved-token copy admits the token is not verified',
        /not on our verified list/i.test(enL.coin.resolvedEvmNote));
    }
  }

  /* ---- 67. the quest list has icons and colour ------------------------- */
  {
    /*
     *   «در صفحه فارم پایین صفحه دعوت دوستان بدون رنگ و ایکون هست»
     *
     * Every quest row drew the same grey `◆`. Six identical diamonds is not
     * a list of six things — and the one that mattered most, "invite a
     * friend", is the only row that brings a new user in. It was the least
     * findable item on the screen.
     */
    const earn = read('src/pages/Earn.jsx');
    const earnCode = earn
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    /* Pinned to the GLYPH. A check for "Icon" would pass for a file that
       merely imports one and still renders the diamond. */
    t('the quest list no longer draws a bare diamond', !earnCode.includes('◆'));

    /*
     * Every quest, not most. A partial fix here is the worst outcome: the
     * rows WITH icons make the ones without look broken rather than plain.
     */
    const quests = [...earnCode.matchAll(/\{ id: '([a-zA-Z0-9]+)', to:[^}]*\}/g)];
    const withIcon = quests.filter((m) => /Icon:\s*Icon[A-Za-z]+/.test(m[0]));
    const withTone = quests.filter((m) => /tone:\s*'var\(--rgb-\d\)'/.test(m[0]));
    t(`every quest has an icon (${withIcon.length}/${quests.length})`,
      quests.length >= 5 && withIcon.length === quests.length);
    t(`every quest has a theme colour (${withTone.length}/${quests.length})`,
      quests.length >= 5 && withTone.length === quests.length);

    /* Colours must be TOKENS, so the light theme follows automatically. */
    t('...and the colours are tokens, not hex values',
      !/tone:\s*'#/.test(earnCode));

    /* The invite row specifically — the reported one — must be distinct
       from every other row rather than sharing a colour with one of them. */
    const invite = quests.find((m) => m[1] === 'inviteFriend');
    t('the invite quest exists', Boolean(invite));
    if (invite) {
      const tone = /tone:\s*'(var\(--rgb-\d\))'/.exec(invite[0])?.[1];
      const others = quests
        .filter((m) => m[1] !== 'inviteFriend')
        .map((m) => /tone:\s*'(var\(--rgb-\d\))'/.exec(m[0])?.[1]);
      t('...and its colour is used by no other quest',
        Boolean(tone) && !others.includes(tone));
    }
  }

  /* ---- 68. hardware-wallet referral: the one that can actually pay ------ */
  {
    const code = (src) => src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    /*
     * ═══════════════════════════════════════════════════════════════════════
     * WHY THIS IS THE ONLY AFFILIATE LINK IN THE APP.
     * ═══════════════════════════════════════════════════════════════════════
     * Every other candidate settles through the banking system. Impact.com
     * (Travala's network) will not pay out without a W-8BEN naming a country
     * of residence, and OFAC FAQ 54 states that an account "with a W-8
     * showing an address in Iran ... should be considered restricted". The
     * money never arrives. Bitrefill pays store credit, not money. Koinly and
     * CoinLedger pay PayPal only.
     *
     * Ledger pays "in Bitcoins" per its own affiliate page. Crypto settlement
     * is the whole reason this one is viable.
     */
    t('the hardware referral module exists', existsSync('src/lib/hardware.js'));
    t('the hardware card exists', existsSync('src/components/HardwareWalletCard.jsx'));

    if (existsSync('src/lib/hardware.js') && existsSync('src/components/HardwareWalletCard.jsx')) {
      const lib = code(read('src/lib/hardware.js'));
      const card = code(read('src/components/HardwareWalletCard.jsx'));
      const wallet = read('src/pages/Wallet.jsx');

      /*
       * ─── THE UNCONFIGURED STATE MUST BE THE CORRECT STATE ───────────────
       * This repo has shipped "wired to nothing" three times. The fix here is
       * that a missing affiliate id yields the PLAIN shop URL, never null and
       * never a broken link — so the card is truthful and useful from day one
       * and simply starts earning when one env var is set.
       */
      t('an unset affiliate id still yields a working link',
        /if \(!id\) return vendor\.url;/.test(lib));

      /*
       * Only https may become an href. A mistyped or hostile env value must
       * not be able to produce a `javascript:` URL — and everything that is
       * not a full https URL goes through URLSearchParams, which percent-
       * encodes it into a query value where it is inert.
       */
      t('...and only an https value is used verbatim',
        /\^https:\\\/\\\//.test(lib) || lib.includes('^https:'));
      t('...anything else is encoded into a query parameter',
        /searchParams\.set/.test(lib));

      /*
       * ─── THE DISCLOSURE IS NOT OPTIONAL, AND IT IS PER VENDOR ───────────
       * The moment a link earns money the reader is owed that fact before
       * tapping. Equally, showing "we earn a commission" over a link that
       * earns nothing is a lie in the other direction — so it must be null
       * when unconfigured.
       */
      t('the disclosure is null when nothing is configured',
        /hardwareConfigured\(vendor\) \? 'hardware\.disclosure' : null/.test(lib));
      t('...and the card renders it per vendor, not once for the card',
        /const disclosure = hardwareDisclosure\(v\)/.test(card));
      /* Pinned to the interpolation: a disclosure that cannot name the real
         rate is the vague "we may earn something" this avoids. */
      t('...naming the real commission rate',
        /rate: v\.rate/.test(card));

      /*
       * ─── PLACEMENT ──────────────────────────────────────────────────────
       * Real tab only. Recommending a $79 device to protect virtual practice
       * credits would be absurd and would read as a plain advert.
       */
      t('the card is wired into the wallet screen', /HardwareWalletCard/.test(wallet));
      t("...on the real tab, not over practice credits",
        /\{tab === 'real' && <HardwareWalletCard \/>\}/.test(code(wallet)));

      /* Both env vars documented, or nobody can ever turn this on. */
      const envx = read('.env.example');
      t('both affiliate ids are documented',
        /VITE_AFFILIATE_LEDGER=/.test(envx) && /VITE_AFFILIATE_TREZOR=/.test(envx));
      /*
       * These are genuinely public identifiers — they appear in an outbound
       * URL the user can read in their own address bar — so VITE_ is correct
       * here. Asserted so a future reader does not "fix" it into a secret.
       */
      t('...as public VITE_ identifiers, which is correct for a tracking id',
        /VITE_AFFILIATE_LEDGER/.test(lib));

      /* Copy in all three written languages, or the card renders raw keys. */
      const enL = JSON.parse(read('src/i18n/locales/en.json'));
      const faL = JSON.parse(read('src/i18n/locales/fa.json'));
      const arL = JSON.parse(read('src/i18n/locales/ar.json'));
      const keys = [...card.matchAll(/t\('(hardware\.[a-zA-Z0-9_.]+)'/g)].map((m) => m[1]);
      const blurbs = ['hardware.ledgerBlurb', 'hardware.trezorBlurb', 'hardware.disclosure'];
      const all = [...new Set([...keys, ...blurbs])];
      const missing = all.filter((k) => !hasKey(enL, k) || !hasKey(faL, k) || !hasKey(arL, k));
      t(`every hardware.* key is translated in all three (${all.length} checked)` +
        (missing.length ? ` — missing: ${missing.join(', ')}` : ''), missing.length === 0);

      /*
       * ─── THE SECOND-HAND WARNING IS THE POINT OF THE CAUTION BOX ────────
       * The known attack is a marketplace device shipped with a pre-generated
       * recovery phrase. A caution box that does not say this is decoration.
       */
      t('the caution names the pre-generated-phrase attack',
        /marketplace/i.test(enL.hardware.caution) &&
        /recovery phrase/i.test(enL.hardware.caution) &&
        /manufacturer/i.test(enL.hardware.caution));
      /*
       * And it must not read as a requirement to use the app. Pinned to the
       * word "required" rather than a phrase, because the sentence is
       * "None of this is required..." and matching a fixed phrase would make
       * this brittle against a harmless rewording.
       */
      t('...and says the device is not required to use FBT Swap',
        /required/i.test(enL.hardware.notRequired) &&
        /FBT Swap/.test(enL.hardware.notRequired));
    }
  }

  /* ---- 69. background radio, dock geometry, banner + infobox spacing ---- */
  {
    const code = (src) => src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    const css = read('src/index.css');

    /*
     * ═══════════════════════════════════════════════════════════════════════
     * 1. THE PLAYER WAS HALF OFF THE SCREEN.
     * ═══════════════════════════════════════════════════════════════════════
     *   «Mp3 player رادیو نصفش در صفحه هست نصفه دیگش رفته باید بیاد وسط»
     *
     * `left: 50%; transform: translateX(-50%)` is the standard centring
     * trick and it is WRONG for a Framer Motion component. Motion writes
     * `animate={{ y }}` to the inline `transform`, which beats the
     * stylesheet — so the -50% correction is erased while `left: 50%`
     * survives, parking the left edge at mid-screen.
     *
     * This exact bug was already fixed once for `.more-layer`. Pinning it
     * here so it cannot come back a third time.
     */
    /*
     * Comments stripped FIRST. The explanation inside this very rule names
     * `translateX(-50%)` as the thing it removed, so an un-stripped match
     * fails on its own documentation. That trap has now caught this suite
     * five separate times, which is why the stripper is applied to the CSS
     * before the block is extracted rather than after.
     */
    const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const apBlock = /\.ap \{[\s\S]*?\n\}/.exec(cssCode)?.[0] ?? '';
    t('the radio player block exists', apBlock.length > 0);
    t('...it does NOT centre with a transform Motion will overwrite',
      !/transform:\s*translateX\(-50%\)/.test(apBlock));
    t('...it centres with auto margins instead',
      /margin-inline:\s*auto/.test(apBlock) && /inset-inline:\s*0/.test(apBlock));

    /*
     * ═══════════════════════════════════════════════════════════════════════
     * 2. BACKGROUND PLAYBACK.
     * ═══════════════════════════════════════════════════════════════════════
     *   «امکان پخش در پس‌زمینه داشته باشد ... با یک ایکون جعبه‌ای ریز»
     *
     * The full chain, because "wired to nothing" is this repo's recurring
     * failure: store → dock → mounted ABOVE the router → the page no longer
     * renders its own player → the pill exists and is reachable.
     */
    t('the radio store exists', existsSync('src/store/useRadioStore.js'));
    t('the radio dock exists', existsSync('src/components/RadioDock.jsx'));

    if (existsSync('src/store/useRadioStore.js') && existsSync('src/components/RadioDock.jsx')) {
      const store = code(read('src/store/useRadioStore.js'));
      const dock = code(read('src/components/RadioDock.jsx'));
      const app = code(read('src/App.jsx'));
      const panel = code(read('src/components/RadioPanel.jsx'));
      const player = code(read('src/components/AudioPlayer.jsx'));

      /*
       * THE PLACEMENT IS THE WHOLE FEATURE. Inside <AnimatedRoutes> the dock
       * would be unmounted on every navigation and nothing would have
       * changed. It must also stay INSIDE HashRouter, because it reads
       * useLocation() to choose between the bar and the pill.
       */
      t('the dock is mounted in App', /<RadioDock \/>/.test(app));
      t('...outside AnimatedRoutes, or it would be unmounted on navigation',
        app.indexOf('<RadioDock />') > app.indexOf('<AnimatedRoutes />') &&
        app.indexOf('<RadioDock />') < app.indexOf('</HashRouter>'));

      /*
       * Exactly ONE AudioPlayer in the tree. A second one means two <audio>
       * elements and two episodes playing at once — and the obvious way to
       * write this bug is to leave the old player on the News screen.
       */
      t('the News panel no longer renders its own player',
        !/<AudioPlayer/.test(panel));
      t('...the dock is the only thing that renders one',
        /<AudioPlayer/.test(dock));

      /*
       * The pill must HIDE the transport, never unmount it. Unmounting
       * destroys the <audio> element and stops the sound, which is the bug.
       * And it must be `visibility`, not `display: none` — several mobile
       * browsers suspend a display:none media element.
       */
      t('the transport is hidden rather than unmounted',
        /is-tucked/.test(dock) && /is-tucked/.test(css));
      const tucked = /\.radio-dock\.is-tucked \{[\s\S]*?\n\}/.exec(cssCode)?.[0] ?? '';
      t('...with visibility, not display:none',
        /visibility:\s*hidden/.test(tucked) && !/display:\s*none/.test(tucked));
      t('...and it cannot swallow taps while hidden',
        /pointer-events:\s*none/.test(tucked));

      /* The pill itself, and that it can reopen the transport. */
      t('the pill exists and is styled', /\.radio-pill \{/.test(css));
      t('...and tapping it reopens the transport', /setExpanded\(true\)/.test(dock));
      t('...and it sits under the transport, not over it',
        /z-index:\s*59/.test(css));
      /* RTL: the pill must land on the thumb side in both directions. */
      t('...positioned with a logical edge so RTL is handled',
        /inset-inline-end/.test(/\.radio-pill \{[\s\S]*?\n\}/.exec(css)?.[0] ?? ''));

      /*
       * "Playing" must come from the ELEMENT, not from the tap. A pill that
       * claims to be playing while the CDN refused the file is the
       * dishonest state this app keeps removing.
       */
      t('playing state is reported up from the audio element',
        /onPlayingChange/.test(player) && /onPlayingChange/.test(dock));

      /*
       * NOT persisted. Restoring "was playing" would try to autoplay on load,
       * which every browser refuses — leaving a bar that lies about what it
       * is doing.
       */
      t('the radio state is not persisted across reloads',
        !/persist/.test(store));

      /* Copy for the pill, in all three written languages. */
      const enL = JSON.parse(read('src/i18n/locales/en.json'));
      const faL = JSON.parse(read('src/i18n/locales/fa.json'));
      const arL = JSON.parse(read('src/i18n/locales/ar.json'));
      t('the pill has an accessible label everywhere',
        hasKey(enL, 'radio.dockOpen') && hasKey(faL, 'radio.dockOpen') &&
        hasKey(arL, 'radio.dockOpen'));
    }

    /*
     * ═══════════════════════════════════════════════════════════════════════
     * 3. THE COLLAPSIBLE BOX WAS WELDED TO WHAT SAT ABOVE IT.
     * ═══════════════════════════════════════════════════════════════════════
     *   «ایکون کشویی ... بدون فاصله چسبیده با دکمه‌های بالا»
     *
     * The only margin was `.infobox + .infobox`, which applies to a box
     * following ANOTHER box. Every InfoBox that is the only one in its
     * section — which is most of them, on a dozen screens — had none.
     */
    const ibBlock = /\n\.infobox \{[\s\S]*?\n\}/.exec(cssCode)?.[0] ?? '';
    t('the collapsible box owns a top margin of its own',
      /margin-top:\s*\d/.test(ibBlock));
    /* ...but not when it opens a container, or there is a dead band at the top. */
    t('...and drops it when it is the first child',
      /\.infobox:first-child \{[^}]*margin-top:\s*0/.test(css));

    /*
     * ═══════════════════════════════════════════════════════════════════════
     * 4. THE BANNER ARTWORK IGNORED THE LIGHT THEME.
     * ═══════════════════════════════════════════════════════════════════════
     *   «در پایین صفحه فارم یک بنر تبلیغاتی هست که ایکون و رنگ‌بندی در تم
     *    سفید اشتباهه»
     *
     * The text and border were converted to readable inks long ago. The SVG
     * was missed because its gradient stops were hard-coded from JSX, and no
     * stylesheet rule can reach an SVG stop attribute. Farm is the screen
     * named in the report because mint-on-white (#00ff9d, 1.30:1) is the
     * weakest pair in the set.
     */
    const ad = code(read('src/components/AdBanner.jsx'));
    t('the banner artwork no longer hard-codes the neon hues',
      !/stopColor=\{cfg\.hues/.test(ad));
    t('...it reads a custom property the theme can override',
      /stopColor="var\(--ad-art-a/.test(ad) && /stopColor="var\(--ad-art-b/.test(ad));
    /* A stop that fails to resolve renders BLACK, so the fallback is not
       cosmetic — a missing variable would be a very visible regression. */
    t('...with a fallback so an unresolved variable never renders black',
      /var\(--ad-art-a, var\(--ad-a\)\)/.test(ad));
    t('...the component still seeds it inline for dark theme',
      /'--ad-art-a': cfg\.hues\[0\]/.test(ad));
    t('...and light theme redirects it to the readable inks',
      /:root\[data-theme='light'\] \.ad-banner \{[^}]*--ad-art-a:\s*var\(--ad-ink\)/.test(css));

    /*
     * ═══════════════════════════════════════════════════════════════════════
     * 5. PERSIAN REGISTER ON THE SWAP SCREEN.
     * ═══════════════════════════════════════════════════════════════════════
     *   «در صفحه سواپ پول‌ات اشتباهه، پول شما درسته»
     *
     * `پول‌ات` is a clumsy construction. Pinned so it cannot return, and
     * checked as a SUBSTRING of the live value rather than an equality test
     * on the whole sentence, which would break on any harmless rewording.
     */
    {
      const faL = JSON.parse(read('src/i18n/locales/fa.json'));
      const title = faL.swap?.custodyTitle ?? '';
      t('the swap custody title uses the polite form',
        title.includes('پول شما') && !title.includes('پول\u200cات'));
    }
  }

  /* ---- 70. the THORChain affiliate address ------------------------------ */
  {
    const code = (src) => src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    /*
     * ═══════════════════════════════════════════════════════════════════════
     * A TYPO HERE SENDS EVERY FEE WE EVER EARN TO NOBODY.
     * ═══════════════════════════════════════════════════════════════════════
     * And it fails SILENTLY: THORChain skips an unparseable affiliate and
     * executes the swap anyway, so a wrong character produces working swaps
     * that simply never pay us. That is the worst possible failure mode
     * because it looks exactly like success.
     *
     * The address below was verified twice against THORChain's own node
     * before being committed — it decodes, and a live quote computed a real
     * fee for it (`"affiliate": "2354442"`). The literal is pinned here so a
     * later edit cannot quietly alter it.
     */
    t('the THORChain module exists', existsSync('src/lib/thorchain.js'));

    if (existsSync('src/lib/thorchain.js')) {
      const thor = code(read('src/lib/thorchain.js'));

      /* The exact verified address, character for character. */
      t('the verified affiliate address is unchanged',
        thor.includes('thor12cqv53jqz6tnzmlsg9y207xe83raeem8nywqxt'));

      /*
       * It must be the FALLBACK, not only an env var. A missing variable in
       * a future deploy would otherwise mean an empty affiliate — swaps keep
       * working, revenue silently stops.
       */
      t('...used as the default when no env var is set',
        /VITE_THOR_AFFILIATE'\) \|\|\s*'thor1/.test(thor));

      /*
       * The 10% ceiling is enforced by the protocol because of a real 2021
       * disclosure (unbounded affiliate fees). Requesting more is rejected
       * outright, so clamping locally is what stops a config mistake from
       * producing quotes that always fail.
       */
      t('the protocol fee cap is enforced locally', /THOR_MAX_BPS = 1000/.test(thor));
      /* Pinned to the whole expression. `[^)]*` fails on the nested
         Math.floor() call — my own first attempt at this check did exactly
         that and reported a false failure against correct code. */
      t('...and the clamp is actually applied',
        thor.includes('Math.min(Math.floor(n), THOR_MAX_BPS)'));

      /*
       * `Number(null)` is 0 and 0 is finite, so a null check MUST come first
       * or a missing value silently becomes a zero fee. This repo has already
       * shipped that exact bug once in validateOrder.
       */
      t('...and a null rate cannot become a silent zero',
        /if \(bps == null\) return THOR_AFFILIATE_BPS;/.test(thor));

      /* Our rate matches the EVM swap fee — one house rate, not two. */
      t('the THORChain rate matches the EVM swap fee (70 bps)',
        /VITE_THOR_AFFILIATE_BPS'\) \|\| 70/.test(thor));

      /*
       * The validator must reject the addresses most likely to be pasted in
       * by mistake — the owner's own Tron and EVM payout addresses both live
       * in this repo and are one copy-paste away.
       */
      t('the address check rejects a Tron address',
        !/\^thor1\[[^\]]*\]\{38\}\$/.test('TJNNUB2zStAvm1wHci5vf9gBGFzbBKjBJZ'));
      t('...and the charset excludes the confusable bech32 characters',
        /023456789acdefghjklmnpqrstuvwxyz/.test(thor) &&
        !/023456789abcdefghi/.test(thor));

      /*
       * The comment must NOT claim to validate a checksum. It does not — a
       * valid-charset typo passes, which I confirmed while testing. Claiming
       * otherwise would invite someone to trust it for a new address.
       */
      t('...and the module admits it is a format check, not a checksum',
        /FORMAT check, not a CHECKSUM check/.test(read('src/lib/thorchain.js')));

      /* Documented, or nobody can ever change the payout address. */
      const envx = read('.env.example');
      t('the affiliate address is documented as configurable',
        /VITE_THOR_AFFILIATE=/.test(envx));
      /*
       * ...and the file must warn against the one catastrophic mistake:
       * putting the recovery phrase where the address goes.
       */
      t('...with an explicit warning never to store the recovery phrase',
        /recovery phrase/i.test(envx) && /NEVER/.test(envx));
    }

    /*
     * ─── THE 12% CLAIM WAS WRONG AND MUST STAY RETRACTED ──────────────────
     * I reported that PROTOCOLAFFILIATEFEEBASISPOINTS (present in the live
     * mimir dump) adds ~12% on top of our fee. Measured against the live
     * network with three quotes, the user pays exactly the requested bps —
     * 70 bps costs 70.1 bps. ADR-016, which defines that mimir, is marked
     * "Status: Proposed" and says "(this mimir needs to be implemented)".
     *
     * The docs must keep the correction rather than quietly reverting to the
     * confident wrong number, so the retraction itself is pinned.
     */
    for (const f of ['docs/STEP-THOR-ADDRESS-FA.md', 'docs/TRAVEL-AND-THORCHAIN-FA.md']) {
      if (!existsSync(f)) continue;
      const doc = read(f);
      t(`${f} keeps the 12% retraction`,
        /Status: Proposed/.test(doc) && /۷۰\.۱ bps/.test(doc));
    }
  }

  /* ---- 71. the deployment budget ---------------------------------------- */
  {
    /*
     * ═══════════════════════════════════════════════════════════════════════
     * WHY PRODUCTION STOPPED UPDATING, AND IT WAS NOT A BUILD FAILURE.
     * ═══════════════════════════════════════════════════════════════════════
     * Six commits in a row reached `main` with green tests, a clean build and
     * a valid vercel.json, and production stayed pinned to an older SHA. My
     * first instinct was another vercel.json schema break — the failure that
     * silently killed seven deploys before. It was not.
     *
     * Counted from the GitHub deployments API instead of guessing:
     *
     *     2026-08-04   78 deployments
     *     2026-08-05  128 deployments      <-- over the Hobby limit
     *     rolling 24h 111 deployments
     *
     * Vercel Hobby allows 100 deployments per rolling 86400 seconds. Past
     * that it returns `api-deployments-free-per-day` and simply does not
     * build. Nothing fails; nothing is reported on the commit. Production
     * just stops moving, which is why it reads as a mystery rather than an
     * error.
     *
     * ─── WHERE THE BUDGET WENT ──────────────────────────────────────────────
     * ONE push was creating FOUR deployments. Two Vercel projects are
     * connected to this repository (`fbtcryp-kkxi` and `fbtcryp4`), and each
     * builds BOTH a Production and a Preview deployment for the same commit:
     *
     *     Production - fbtcryp-kkxi
     *     Preview    - fbtcryp-kkxi
     *     Production - fbtcryp4
     *     Preview    - fbtcryp4
     *
     * Verified per-SHA: every commit before the cap shows exactly 4, and the
     * commits after it show 3, 1, 3, 0 as the quota ran out.
     *
     * Only `fbtcryp-kkxi` serves fbtswap.ir. So three quarters of every
     * commit's budget was spent on builds nobody looks at.
     *
     * ─── THE FIX, WHICH COSTS NOTHING ───────────────────────────────────────
     * `git.deploymentEnabled` with a glob turns off automatic PREVIEW builds
     * for the working branch. Production still deploys, because production
     * tracks `main` and `main` is not matched by the pattern. That halves the
     * spend immediately and needs no dashboard access and no paid plan.
     *
     * The remaining duplication is the second PROJECT, which cannot be fixed
     * from this file — it needs someone to disconnect `fbtcryp4` in the
     * Vercel dashboard. Documented rather than silently left.
     */
    const vj = JSON.parse(read('vercel.json'));

    t('vercel.json disables preview builds for the working branch',
      vj.git?.deploymentEnabled?.['arena/*'] === false);

    /*
     * PRODUCTION MUST NOT BE CAUGHT BY THE RULE. This is the one way this
     * change could be catastrophic: a pattern that also matches `main` would
     * turn off production deploys entirely, and the symptom would be
     * identical to the bug it is meant to fix — the site silently not
     * updating. So the branch that actually serves the site is asserted to be
     * unaffected, both explicitly and via the glob.
     */
    const rules = vj.git?.deploymentEnabled ?? {};
    t('...but never disables main',
      rules.main !== false && rules['*'] !== false && rules['**'] !== false);
    t('...and deploymentEnabled is not switched off wholesale',
      vj.git?.deploymentEnabled !== false);

    /*
     * `git` must be a KNOWN key. The schema at openapi.vercel.sh declares
     * `additionalProperties: false`, so an invented key does not warn — it
     * makes the whole file invalid and the build dies before it starts, which
     * is exactly how seven deploys were lost to a `"//"` comment. `git` is
     * documented at vercel.com/docs/project-configuration/git-configuration.
     * Section 12 already guards the top-level allowlist; this pins the shape.
     */
    t('...and the git block holds only deploymentEnabled',
      Object.keys(vj.git ?? {}).every((k) => k === 'deploymentEnabled'));

    /* The diagnosis has to survive in writing, or the next person spends
       another hour blaming the CDN. */
    t('the deployment-budget diagnosis is documented',
      existsSync('docs/VERCEL-DEPLOY-LIMIT-FA.md'));
  }

  /* ---- 72. the poisoned-module crash, nav glyph, calm music ------------- */
  {
    const code = (src) => src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    /*
     * ═══════════════════════════════════════════════════════════════════════
     * 1. TAP A COIN -> CRASH. RELOAD -> WORKS FOREVER.
     * ═══════════════════════════════════════════════════════════════════════
     *   «باگ صفحه بازار وقتی میزنی روی یک کوین کرش میکنه ... وقتی بازنشانی
     *    میکنی میره داخل و دیگه کرش نمیزنه»
     *
     * That shape IS the diagnosis. The coin, the component and the API
     * response are identical before and after a reload, so it cannot be data
     * or code. The browser's MODULE MAP caches the RESULT of a dynamic import
     * INCLUDING a failure — Vite's own docs say "you cannot retry the dynamic
     * import due to browser limitations" — so once
     * `import('./pages/CoinDetail')` has rejected once, every later call
     * replays the cached rejection with no network request. A reload builds a
     * fresh map.
     *
     * The likeliest thing that poisons it is our OWN idle prefetch, which
     * warms CoinDetail and swallows failures. The swallow is right; its
     * side-effect on the module map is not.
     */
    t('the lazy-retry wrapper exists', existsSync('src/lib/lazyRetry.js'));

    if (existsSync('src/lib/lazyRetry.js')) {
      const lr = code(read('src/lib/lazyRetry.js'));
      const app = code(read('src/App.jsx'));

      /*
       * A NEW SPECIFIER is the only thing that defeats the module map, since
       * it is keyed by resolved URL. A retry that reuses the same URL would
       * replay the cached rejection and change nothing.
       */
      t('...the retry busts the module-map cache with a fresh URL',
        /searchParams\.set\('t'/.test(lr));
      /*
       * Timestamped, not a fixed marker. `?retry=1` would itself be cached
       * after its first failure, reintroducing the same bug one layer down.
       */
      t('...using a timestamp, so a second incident is not cached too',
        /String\(Date\.now\(\)\)/.test(lr));

      /*
       * Only TRANSPORT failures may be retried. Re-running a module that
       * threw a real error during evaluation would run its side effects twice
       * and still fail, delaying the honest error screen.
       */
      t('...only load failures are retried, never a real crash',
        /if \(!isLoadFailure\(error\)\) throw error;/.test(lr));

      /* Every route, or the ones left behind still crash. */
      const converted = (app.match(/lazyRetry\(\(\) => import\(/g) ?? []).length;
      const plain = (app.match(/[^y]lazy\(\(\) => import\(/g) ?? []).length;
      t(`every route uses the retrying loader (${converted} routes, ${plain} left on plain lazy)`,
        converted >= 30 && plain === 0);

      /*
       * The prefetch must not run on a connection that cannot finish. Its
       * failure is what poisons the map in the first place, and saveData
       * users should never have been paying for it.
       */
      t('the idle prefetch is skipped on save-data and 2G',
        /conn\.saveData/.test(app) && /effectiveType/.test(app));
      /*
       * ...but ABSENCE of the API must mean "go ahead". navigator.connection
       * is Chromium-only; treating unknown as slow would disable prefetching
       * for every Firefox and Safari user.
       */
      t('...but an unknown connection still prefetches',
        /const conn = navigator\.connection;\s*if \(conn\) \{/.test(app));
    }

    /*
     * ─── 2. THE CENTRE GLYPH WAS TOO SMALL ────────────────────────────────
     *   «ایکون وسط دایره خیلی کم بزرگترش کن»
     *
     * The circle grew 42px -> 56px when it was resized to fill the notch and
     * the glyph never grew with it, so the most important target in the bar
     * carried the smallest mark on screen. Pinned to the SAME number the four
     * flat icons use, because matching them is the actual argument.
     */
    const nav = read('src/components/BottomNav.jsx');
    const centreSvg = /<svg\s+width="(\d+)"/.exec(code(nav))?.[1];
    t(`the centre glyph matches the other nav icons (${centreSvg}px)`,
      centreSvg === '21');
    t('...and the flat icons are still that size',
      /width=\{21\}/.test(code(nav)));

    /*
     * ─── 3. CALM MUSIC ────────────────────────────────────────────────────
     *   «یک تب از اهنگ های ارامشبخش ... ارامش در سرمایه گذاری»
     *
     * The whole engineering problem here is LICENSING. Streaming music we do
     * not have rights to is a lawsuit, not a bug.
     */
    t('the calm-music module exists', existsSync('server/calm.js'));

    if (existsSync('server/calm.js')) {
      const calm = code(read('server/calm.js'));
      const appSrc = code(read('server/app.js'));

      /* The full chain, because "wired to nothing" is this repo's classic. */
      t('...the route is mounted', /['"`]\/api\/calm['"`]/.test(appSrc));
      t('...and calls the fetcher', /fetchCalm/.test(appSrc));
      t('...the client library calls the route', /\/calm/.test(code(read('src/lib/audio.js'))));
      t('...the panel exists', existsSync('src/components/CalmPanel.jsx'));
      t('...News imports it', /CalmPanel/.test(read('src/pages/News.jsx')));
      /* Still last: market intelligence now sits immediately after Radio. */
      t('...and renders it behind its own tab',
        /'listen', 'insights', 'calm'/.test(code(read('src/pages/News.jsx'))) &&
        /tab === 'calm'/.test(code(read('src/pages/News.jsx'))));

      /*
       * ─── THE LICENCE GATE IS THE SAFETY PROPERTY ────────────────────────
       * The first netlabels item I opened by hand was by-nc-nd/2.5 —
       * NonCommercial AND NoDerivatives. We are a commercial product, so NC
       * alone disqualifies it. A collection being "free music" says nothing
       * about an individual item's terms.
       */
      t('...NonCommercial and NoDerivatives are rejected',
        /DENIED_LICENCE = \['-nc', '-nd'\]/.test(calm));
      t('...and the deny list is checked before the allow list',
        calm.indexOf('DENIED_LICENCE.some') < calm.indexOf('ALLOWED_LICENCE.some'));
      /* An unlicensed item must be dropped: silence is not permission. */
      t('...a track with no recognised licence is dropped, not credited wrongly',
        /if \(!label\) return null;/.test(calm));
      /*
       * Attribution is a CONDITION of CC BY / CC BY-SA, not a courtesy, so
       * the artist must reach the screen.
       */
      t('...the licence and artist are shown on every row',
        /item\.licence/.test(read('src/components/CalmPanel.jsx')) &&
        /item\.stationName/.test(read('src/components/CalmPanel.jsx')));

      /* One player for both tabs, or two things play at once. */
      t('...calm music drives the same shared player as the radio',
        /useRadioStore/.test(read('src/components/CalmPanel.jsx')));
      t('...and renders no player of its own',
        !/<AudioPlayer/.test(read('src/components/CalmPanel.jsx')));

      /*
       * freepd.com — the obvious source — is DEAD. Fetched it: "Site Closed".
       * Every blog recommending it now points at nothing, and building on it
       * would have shipped the dead-button failure this project keeps fixing.
       */
      t('...and it does not depend on the now-closed freepd.com',
        !/freepd\.com/.test(calm));

      /* Copy in all three written languages, or the tab renders raw keys. */
      const enL = JSON.parse(read('src/i18n/locales/en.json'));
      const faL = JSON.parse(read('src/i18n/locales/fa.json'));
      const arL = JSON.parse(read('src/i18n/locales/ar.json'));
      const keys = ['calm.title', 'calm.whyTitle', 'calm.why1', 'calm.why2',
        'calm.why3', 'calm.credit', 'news.tab.calm'];
      const miss = keys.filter((k) => !hasKey(enL, k) || !hasKey(faL, k) || !hasKey(arL, k));
      t(`every calm.* key is translated in all three${miss.length ? ` — missing: ${miss.join(', ')}` : ''}`,
        miss.length === 0);

      /*
       * The copy must carry the OWNER'S argument — calm leads to better
       * decisions — rather than reading as a music perk. That framing is the
       * only thing that justifies music on a screen about money.
       */
      t('...and the explanation makes the investing argument, not a perk pitch',
        /decision/i.test(enL.calm.why1) && /panic/i.test(enL.calm.why2));
      /* And it must not read as advice. */
      /* Matched on the word, not a fixed phrase: "Nothing here is advice"
         and "this is not advice" both satisfy the requirement, and pinning
         one wording makes the check brittle against a harmless rewrite. */
      t('...while stating plainly that it is not advice',
        /\badvice\b/i.test(enL.calm.why3));
    }
  }

  /* ---- 73. THORChain native swaps, and the 80-byte memo wall ------------ */
  {
    const code = (src) => src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    t('the THORChain server module exists', existsSync('server/thorchain.js'));
    t('the native-swap panel exists', existsSync('src/components/ThorPanel.jsx'));

    if (existsSync('server/thorchain.js') && existsSync('src/components/ThorPanel.jsx')) {
      const thor = code(read('server/thorchain.js'));
      const appSrc = code(read('server/app.js'));
      const lib = code(read('src/lib/thorswap.js'));
      const panel = code(read('src/components/ThorPanel.jsx'));
      const bridge = code(read('src/pages/Bridge.jsx'));

      /* Full chain: module -> routes -> routes call it -> lib -> panel ->
         page imports it -> page RENDERS it. */
      t('...the quote route is mounted', /['"`]\/api\/thor\/quote['"`]/.test(appSrc));
      t('...the pools route is mounted', /['"`]\/api\/thor\/pools['"`]/.test(appSrc));
      t('...and the routes call the module',
        /thorQuote\(/.test(appSrc) && /fetchThorPools/.test(appSrc));
      t('...the client library calls them', /\/thor\/quote/.test(lib) && /\/thor\/pools/.test(lib));
      t('...the panel uses the library', /getThorQuote/.test(panel));
      t('...Bridge imports it', /ThorPanel/.test(read('src/pages/Bridge.jsx')));
      t('...and renders it behind a tab',
        /mode === 'native'/.test(bridge) && /<ThorPanel \/>/.test(bridge));

      /*
       * ═════════════════════════════════════════════════════════════════════
       * THE 80-BYTE MEMO WALL — the reason this module is shaped as it is.
       * ═════════════════════════════════════════════════════════════════════
       * On Bitcoin the memo rides in an OP_RETURN capped at 80 bytes, and our
       * raw thor1 address is 43 characters. Measured against the live API:
       *
       *   BTC.BTC -> ETH.ETH, no affiliate     -> quote OK
       *   BTC.BTC -> ETH.ETH, + our address    -> {"code":2, "message":
       *                                            "generated memo too long
       *                                             for source chain"}
       *   ETH.ETH -> BTC.BTC, + our address    -> "affiliate": "20608"  ✅
       *
       * So the fee is applied PER SOURCE CHAIN. Getting this wrong in either
       * direction is expensive: include it everywhere and Bitcoin swaps stop
       * quoting at all; omit it everywhere and every ETH/AVAX/BSC/Cosmos swap
       * earns nothing for a limit that does not apply to them.
       */
      t('the UTXO chains are excluded from the fee',
        /TIGHT_MEMO_CHAINS = new Set\(\['BTC', 'BCH', 'LTC', 'DOGE'\]\)/.test(thor));
      t('...and the roomy chains still carry it',
        /return TIGHT_MEMO_CHAINS\.has\(chainOf\(fromAsset\)\) \? null : AFFILIATE;/.test(thor));
      /*
       * A THORName is short enough for every chain, so it must short-circuit
       * the whole exclusion — that one env var is the entire upgrade path.
       */
      t('...and a THORName turns the excluded chains back on',
        /if \(THORNAME\) return THORNAME;/.test(thor));

      /*
       * The verified address, character for character. A typo would send
       * every fee to an address nobody controls, and SILENTLY — THORChain
       * skips an unparseable affiliate and executes the swap anyway.
       */
      t('the verified affiliate address is unchanged',
        thor.includes('thor12cqv53jqz6tnzmlsg9y207xe83raeem8nywqxt'));
      /* As a DEFAULT, not only an env var, so a missing variable in a future
         deploy cannot silently zero the revenue. */
      t('...used as the default, not only as an env var',
        /THOR_AFFILIATE \|\|\s*'thor1/.test(thor));

      /*
       * The fee parameters must NEVER come from the caller. Same rule as the
       * LI.FI bridge: a query-string affiliate lets anyone redirect our
       * commission to their own wallet.
       */
      t('the affiliate is set server-side, never from the query',
        /qs\.set\('affiliate', affiliate\)/.test(thor) &&
        !/req\.query\.affiliate/.test(appSrc));

      /*
       * If the memo overflows anyway, retry WITHOUT the fee rather than
       * showing the user an error about our configuration. A working swap
       * that earns nothing beats a broken one that earns nothing.
       */
      t('...and an overflow falls back to a fee-free quote, not an error',
        /memo too long/i.test(thor) && /qs\.delete\('affiliate'\)/.test(thor));

      /*
       * ─── WE QUOTE, WE DO NOT SEND ───────────────────────────────────────
       * We hold no Bitcoin keys. A wrong memo character loses the funds
       * permanently — not reverted, gone. The panel must show the address and
       * memo for the user's own wallet and must not pretend to execute.
       */
      t('the panel shows the inbound address and memo for the user to send',
        /inbound_address/.test(panel) && /quote\.memo/.test(panel));
      t('...and warns that the memo must be exact',
        /memoWarning/.test(panel));

      /* Halted chains must never reach a dropdown. */
      /*
       * ─── MORE THAN ONE NODE, BECAUSE ONE FAILED IN PRODUCTION ──────────
       * Shipped with a single host and it broke on deploy: /api/thor/status
       * (no upstream call) answered while /pools and /quote both returned
       * "fetch failed" — a CONNECTION failure, not a rejected request. The
       * Vercel function could not reach that host at all, though the same URL
       * answers from elsewhere. gateway.liquify.com is the endpoint
       * THORChain's own developer docs list first.
       */
      t('several THORChain nodes are tried, not one', /THOR_NODES = /.test(thor));
      t('...with the endpoint their own docs list first',
        thor.includes('gateway.liquify.com/chain/thorchain_api'));
      t('...and at least one independent fallback',
        thor.includes('thornode.ninerealms.com'));
      /*
       * A BUSINESS error must not trigger failover. "memo too long" is a
       * correct answer; the next node would say the same thing, and retrying
       * would triple the latency of every legitimate rejection.
       */
      t('...only a transport failure moves to the next node',
        thor.includes('lastErr = err;'));
      /* Per-attempt timeout, or three nodes could hold a function 45s. */
      t('...with a per-attempt timeout short enough for three tries',
        thor.includes('THOR_TIMEOUT_MS || 8000'));

      t('halted pools are filtered out server-side',
        /trading_halted === false/.test(thor));

      /*
       * Amount is validated as an integer STRING. Number() would accept
       * scientific notation and lose precision above 2^53 — only ~90 million
       * units on an 8-decimal chain.
       */
      t('the amount is validated as integer base units',
        /\^\\d\{1,20\}\$/.test(thor));

      /* Copy in all three written languages, or the tab renders raw keys. */
      const enL = JSON.parse(read('src/i18n/locales/en.json'));
      const faL = JSON.parse(read('src/i18n/locales/fa.json'));
      const arL = JSON.parse(read('src/i18n/locales/ar.json'));
      const keys = [...panel.matchAll(/t\('(thor\.[a-zA-Z0-9_.]+)'/g)].map((m) => m[1]);
      const all = [...new Set([...keys, 'bridge.mode.tokens', 'bridge.mode.native',
        'thor.err.QUOTE_FAILED', 'toast.memoCopied'])];
      const miss = all.filter((k) => !hasKey(enL, k) || !hasKey(faL, k) || !hasKey(arL, k));
      t(`every thor.* key is translated in all three (${all.length} checked)` +
        (miss.length ? ` — missing: ${miss.join(', ')}` : ''), miss.length === 0);

      /*
       * The copy must be honest about the two things that can cost the user
       * money: an irreversible destination, and a memo that must be exact.
       */
      t('...the destination warning says it cannot be reversed',
        /reverse/i.test(enL.thor.destinationNote));
      t('...and the no-fee note explains WHY rather than hiding it',
        /80 bytes/.test(enL.thor.noFeeNote));
    }
  }

  /* ---- 74. fiat pulled, swap unified, projection folded ----------------- */
  {
    const code = (src) => src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    const buy = read('src/pages/Buy.jsx');
    const buyCode = code(buy);

    /*
     * ═══════════════════════════════════════════════════════════════════════
     * 1. THE CHANGENOW PANEL IS OFF THE BUY SCREEN.
     * ═══════════════════════════════════════════════════════════════════════
     * The partner told the owner fiat is suspended until September. The panel
     * was NOT visibly broken — /api/fiat/status still answered
     * {"enabled":true} in production — so the form rendered, took an amount,
     * and would only have failed when somebody pressed the button with real
     * money in hand. That is the worst place in the app to learn a partner is
     * offline.
     */
    t('the fiat panel is off the buy screen', !/FiatPanel/.test(buyCode));

    /*
     * The server module and its routes STAY. Nothing is thrown away and
     * re-enabling is a one-line revert; deleting them would turn a two-month
     * pause into a rewrite.
     */
    t('...but the fiat module is kept for when it returns',
      existsSync('server/fiat.js') && /\/api\/fiat\/quote/.test(read('server/app.js')));

    /*
     * ─── THE REPLACEMENT LINKS WERE EACH OPENED, NOT COPIED ────────────────
     * Verified live: Bisq — "No registration required", 2-of-2 multisig, Tor
     * by default, open source. Hodl Hodl — "Non-custodial", "Anonymous — No
     * verification required", multisig escrow, 100+ currencies.
     *
     * freepd.com taught this lesson last week: a source everyone recommends
     * can simply be gone.
     */
    t('...replaced by desks that need no identity check',
      /bisq\.network/.test(buyCode) && /hodlhodl\.com/.test(buyCode));
    /* https only — these open in a Custom Tab where the domain is visible. */
    t('...over https',
      !/http:\/\/(bisq|hodlhodl)/.test(buyCode));

    {
      const enL = JSON.parse(read('src/i18n/locales/en.json'));
      const faL = JSON.parse(read('src/i18n/locales/fa.json'));
      for (const id of ['bisq', 'hodlhodl']) {
        t(`the ${id} route is described in en and fa`,
          hasKey(enL, `buy.route.${id}.name`) && hasKey(enL, `buy.route.${id}.buy`) &&
          hasKey(faL, `buy.route.${id}.name`) && hasKey(faL, `buy.route.${id}.buy`));
      }
      /*
       * Each entry must state its real limitation. Bisq is desktop-only and
       * Hodl Hodl is Bitcoin-only; a directory that hides those sends people
       * to a door they cannot open, which is the dead-button failure with
       * extra steps.
       */
      t('...and each names its own limitation',
        /[Dd]esktop only/.test(enL.buy.route.bisq.buy) &&
        /Bitcoin only/.test(enL.buy.route.hodlhodl.buy));
    }

    /*
     * ═══════════════════════════════════════════════════════════════════════
     * 2. SWAP AND SOLANA SWAP ARE ONE SCREEN.
     * ═══════════════════════════════════════════════════════════════════════
     */
    const swap = code(read('src/pages/Swap.jsx'));
    const more = code(read('src/components/MoreSheet.jsx'));

    t('Solana is a tab inside the swap screen',
      /<SolanaSwap embedded \/>/.test(swap) && /chainTab === 'solana'/.test(swap));
    /*
     * `embedded` matters: nesting two PageTransitions animates the same
     * subtree twice and produces a visible double-fade on every tab change.
     */
    t('...rendered embedded, so it does not nest a second page transition',
      /PageTransition embedded=\{embedded\}/.test(code(read('src/pages/SolanaSwap.jsx'))));
    t('...and removed from the More menu', !/'\/solana'/.test(more));
    /*
     * The ROUTE must survive. Links are already shared, and the Stocks and
     * Farm screens hand off with ?to=<mint>. A menu entry is discovery; a
     * route is a contract.
     */
    t('...while the /solana route still works for existing links',
      /path="\/solana"/.test(read('src/App.jsx')));

    /* Both tabs need labels or the strip renders raw keys. */
    {
      const enL = JSON.parse(read('src/i18n/locales/en.json'));
      const faL = JSON.parse(read('src/i18n/locales/fa.json'));
      const arL = JSON.parse(read('src/i18n/locales/ar.json'));
      t('...and both chain tabs are labelled everywhere',
        ['swap.chainTab.evm', 'swap.chainTab.solana']
          .every((k) => hasKey(enL, k) && hasKey(faL, k) && hasKey(arL, k)));
    }

    /*
     * ─── EVERY EVM CHAIN THE APP OFFERS MUST BE SWAPPABLE ──────────────────
     * Asked directly: «سواپ ببین همه شبکه‌ها را در بر گرفته». A chain in the
     * picker that the aggregator cannot route is a dead dropdown entry.
     */
    {
      const chains = code(read('src/lib/chains.js'));
      const agg = code(read('src/lib/aggregator.js'));
      const ids = [...chains.matchAll(/^\s{2}(\d+):\s*\{/gm)].map((m) => m[1]);
      const missing = ids.filter((id) => !new RegExp(`\\b${id}:`).test(agg));
      t(`every configured EVM chain is routable (${ids.length} chains)` +
        (missing.length ? ` — missing ${missing.join(', ')}` : ''),
        ids.length >= 7 && missing.length === 0);
    }

    /*
     * ═══════════════════════════════════════════════════════════════════════
     * 3. THE WEEKLY / MONTHLY PROJECTION IS FOLDED AWAY.
     * ═══════════════════════════════════════════════════════════════════════
     * It is the single most speculative thing on the Signals page — a
     * volatility range, not a forecast — and it sat always-open between the
     * indicators and the buy/sell buttons.
     */
    const sig = code(read('src/pages/Signals.jsx'));
    t('the weekly/monthly projection is inside a collapsible box',
      /InfoBox title=\{t\('signals\.projectionTitle'\)\}/.test(sig));
    /* Nested card must not draw a second competing surface. */
    t('...and the nested card does not double up its border',
      /card card-soft/.test(sig) && /\.card-soft \{/.test(read('src/index.css')));
    {
      const enL = JSON.parse(read('src/i18n/locales/en.json'));
      const faL = JSON.parse(read('src/i18n/locales/fa.json'));
      t('...with a translated title',
        hasKey(enL, 'signals.projectionTitle') && hasKey(faL, 'signals.projectionTitle'));
    }

    /* The prettier box: a gradient surface, and light theme handled too. */
    {
      const css = read('src/index.css').replace(/\/\*[\s\S]*?\*\//g, '');
      const box = /\n\.infobox \{[\s\S]*?\n\}/.exec(css)?.[0] ?? '';
      t('the collapsible box has a real surface, not a flat wash',
        /linear-gradient/.test(box) && /box-shadow/.test(box));
      t('...and light theme gets its own, since white-on-white is invisible',
        /:root\[data-theme='light'\] \.infobox \{[^}]*linear-gradient/.test(css));
    }
  }

  /* ---- 75. Solana swap routed through OpenOcean so it actually earns ----- */
  {
    const code = (src) => src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    /*
     * ═══════════════════════════════════════════════════════════════════════
     * THE BUG CLASS THIS SECTION EXISTS FOR: "wired to nothing".
     * ═══════════════════════════════════════════════════════════════════════
     * Shipped three times already (bridge, gasless, fiat): a module is
     * written, tested, and never reachable from the screen. Solana is the
     * worst possible place to repeat it, because the OLD path also "works" —
     * swaps succeed and earn zero, which is indistinguishable from success.
     *
     * So every link in the chain is asserted: server module -> route ->
     * route calls it -> client lib -> page imports it -> page CALLS it ->
     * the old earning-nothing path is gone.
     */
    const srv = existsSync('server/solanaOcean.js') ? read('server/solanaOcean.js') : '';
    t('server/solanaOcean.js exists', Boolean(srv));

    const srvCode = code(srv);

    /* The fee params must be set by US, never forwarded from a caller. */
    t('the referrer is attached server-side, not taken from the request',
      /params\.set\('referrer',/.test(srvCode) &&
      /params\.set\('referrerFee',/.test(srvCode));
    t('...and the payout address defaults to the published Solana wallet',
      /B6gysn5JGQQnJmyzjj6ZJiNECjDYYyJ5LrXvr61BFLv4/.test(srvCode));

    /*
     * bps -> PERCENT. OpenOcean wants 0.7 for 70 bps and accepts up to 5.
     * Sending 70 where a percent is expected requests 70% of the swap, so the
     * literal divisor is pinned rather than checked loosely.
     */
    t('bps are converted to percent (70 -> 0.7), not passed raw',
      /Number\(bps\) \/ 100/.test(srvCode));
    t('...and the rate is clamped so a typo cannot request an outrageous cut',
      /Math\.min\(100, Math\.max\(0,/.test(srvCode));

    /*
     * The echo check. A fee we asked for and did not get is this repo's most
     * expensive recurring bug — it must be detected, not assumed.
     */
    t('the returned feeRatio is compared against what we asked for',
      /feeApplied/.test(srvCode) && /Math\.abs\(got - asked\)/.test(srvCode));
    t('...with a tolerance, because 0.7% comes back as 0.006999999999999999',
      /1e-6/.test(srvCode));

    /* Routes exist AND call the module. */
    const app = code(read('server/app.js'));
    t('app.js imports the OpenOcean Solana module',
      /from '\.\/solanaOcean\.js'/.test(app));
    for (const [route, fn] of [
      ['/api/solana/oo/status', 'oceanStatus'],
      ['/api/solana/oo/quote', 'oceanQuote'],
      ['/api/solana/oo/swap', 'oceanSwap']
    ]) {
      t(`${route} is mounted and calls ${fn}()`,
        new RegExp(`'${route.replace(/\//g, '\\/')}'`).test(app) &&
        new RegExp(`${fn}\\(`).test(app));
    }

    /* Client lib exists and points at our own API, never OpenOcean directly. */
    const lib = existsSync('src/lib/solanaOcean.js') ? read('src/lib/solanaOcean.js') : '';
    t('src/lib/solanaOcean.js exists', Boolean(lib));
    const libCode = code(lib);
    t('the client calls OUR api, so the fee fields stay unforgeable',
      /\/solana\/oo\/quote/.test(libCode) && /\/solana\/oo\/swap/.test(libCode));
    t('...and never calls OpenOcean from the browser, which would expose them',
      !/open-api\.openocean\.finance/.test(libCode));

    /*
     * THE LINK THAT MATTERS MOST: the page must actually use it. A perfect
     * library nobody imports is the exact shape of the three past failures.
     */
    const page = read('src/pages/SolanaSwap.jsx');
    const pageCode = code(page);
    t('SolanaSwap imports the OpenOcean client',
      /from '\.\.\/lib\/solanaOcean'/.test(pageCode));
    t('...and QUOTES through it', /getOceanQuote\(/.test(pageCode));
    t('...and BUILDS the swap through it', /getOceanSwap\(/.test(pageCode));

    /*
     * The old Jupiter execution path must be GONE from this screen, not just
     * unused. Left importable, a later edit re-reaches for it and silently
     * returns the screen to earning nothing.
     */
    t('the earning-nothing Jupiter order path is no longer used here',
      !/getSolanaOrder\(/.test(pageCode) && !/executeSolanaOrder\(/.test(pageCode));

    /*
     * Sign-AND-send, not sign-only. Jupiter lands its own transactions;
     * OpenOcean does not. Using the Jupiter helper would leave the trade
     * unsent while the UI reported success.
     */
    const wallet = code(read('src/lib/solanaWallet.js'));
    t('a sign-and-broadcast helper exists for the OpenOcean path',
      /export async function signAndSendSolana/.test(wallet));
    t('...and it is the one the page calls', /signAndSendSolana\(/.test(pageCode));
    t('...and it uses signAndSendTransaction, since nobody else broadcasts',
      /signAndSendTransaction/.test(wallet));

    /*
     * The button used to be gated on `order.transaction`, which Jupiter's
     * quote carried and ours deliberately does not. Unchanged, that is a
     * permanently disabled button on a working integration.
     */
    t('the swap button is gated on a quote, not on a transaction',
      /disabled=\{!address \|\| !order\?\.outAmount \|\| busy\}/.test(pageCode));

    /*
     * The disclosure must follow the SAME number that is charged. It read
     * solanaFeeReady() — a Jupiter-only flag that now answers false, which
     * would tell every user the swap is free while charging 0.70%.
     */
    t('the fee notice follows the quote, so it cannot understate the charge',
      /order\?\.feeBps/.test(pageCode) && !/solanaFeeReady\(\)\n?\s*\?/.test(pageCode));
  }

  /* ---- 76. cross-chain / Tron, and the fee that must cross families ----- */
  {
    const code = (src) => src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    const srv = existsSync('server/xchain.js') ? read('server/xchain.js') : '';
    t('server/xchain.js exists', Boolean(srv));
    const c = code(srv);

    /*
     * ═══════════════════════════════════════════════════════════════════════
     * THE FAMILY RULE, WHICH IS THE WHOLE REASON TRON IS DELICATE.
     * ═══════════════════════════════════════════════════════════════════════
     * 0x: "feeRecipient addresses must be valid for the origin chain's address
     * format." A Tron-origin swap paying an EVM address is not a smaller
     * mistake than paying nobody — it is money sent where no key exists.
     */
    t('the fee address is chosen per origin chain, not fixed',
      /export function feeRecipientFor\(/.test(c));
    t('...and an EVM origin gets the EVM one',
      /0xaf5CE154cEfd22Da5BD1D0a54479E81963A224d6/.test(c));
    t('...with both address shapes validated',
      /\^T\[1-9A-HJ-NP-Za-km-z\]\{33\}\$/.test(c) && /\^0x\[a-fA-F0-9\]\{40\}\$/.test(c));

    /*
     * ═══════════════════════════════════════════════════════════════════════
     * MEASURED: 0x PAY NO FEE ON A TRON ORIGIN, AND 400 IF YOU ASK.
     * ═══════════════════════════════════════════════════════════════════════
     * This module was first written expecting a Tron-origin fee, because the
     * monetisation guide carves out no exception. The live probe returned:
     *
     *   "Fee collection is not supported when origin chain is Tron"
     *
     * on feeBps, feeRecipient AND feeToken — as a hard 400, so sending them
     * does not merely fail to earn, it kills the quote. Shipping from the
     * documentation alone would have produced a Tron tab that returned
     * INPUT_INVALID on every request.
     *
     * The guard is therefore load-bearing, not cosmetic, and is pinned here
     * so nobody "tidies" it away and silently breaks Tron.
     */
    t('no fee is requested on a Tron origin, which would 400 the whole quote',
      /feeSupportedOn\(originChain\) \? feeBps\(\) : 0/.test(c));
    t('...and the Tron fee address is empty, not our Tron wallet, since none is payable',
      /isTronOrigin\(originChain\)\) return '';/.test(c));
    t('...and the echo check does not cry wolf where a fee is impossible',
      /bps > 0/.test(c));

    /*
     * ─── THE 17% TRAP ───────────────────────────────────────────────────────
     * A live EVM->Tron quote returned 8.288473 USDT for 10 USDC. Our fee is
     * 0.30% of that; the rest is bridge plus Tron account activation, which
     * is near-FLAT — trivial on 1000 USDT, ruinous on 10.
     *
     * Both raw numbers look reasonable alone. Only the percentage exposes it,
     * so it is computed where both amounts are known rather than left to a
     * screen to re-derive, and a severe case is flagged rather than printed
     * quietly next to a confirm button.
     */
    t('the real percentage lost is computed, not left to the UI',
      /lossPercent/.test(c));
    t('...and a severe loss is flagged so it cannot be shown in small text',
      /severeLoss/.test(c) && /lossPercent > 5/.test(c));
    t('...and it stays null for unlike units rather than inventing a number',
      /sameUnit/.test(c));

    /*
     * Bridging into an address of the WRONG family is an irreversible burn.
     * 0x defaults destinationAddress to the origin address, which across a
     * family boundary is exactly that burn, so it must be refused.
     */
    t('a cross-family swap refuses to proceed without a destination address',
      /DESTINATION_ADDRESS_REQUIRED/.test(c));

    /* Fee params are ours alone — never readable off the query string. */
    t('feeRecipient and feeBps are set server-side',
      /params\.set\('feeRecipient',/.test(c) && /params\.set\('feeBps',/.test(c));
    t('...and are clamped so a typo cannot take someone whole transfer',
      /Math\.min\(100, Math\.max\(0,/.test(c));

    /* The echo check, same rule as the Solana and EVM paths. */
    t('a requested fee that did not arrive is surfaced, not assumed',
      /feeApplied/.test(c) && /integratorFees/.test(c));

    /*
     * The probe. Documentation is not measurement — the key lives in Vercel,
     * so the only way to learn whether Tron works on OUR key is to ask from
     * inside our own server.
     */
    t('a read-only probe exists to test Tron from inside the server',
      /export async function crossChainProbe/.test(c));
    t('...and it distinguishes "product not enabled" from "no route"',
      /accessDenied/.test(c) && /tronRouteFound/.test(c));
    t('...and it signs nothing, only requesting a quote',
      !/sendRawTransaction|signTransaction/.test(c));

    /* Routes exist AND call the module. */
    const app = code(read('server/app.js'));
    t('app.js imports the cross-chain module',
      /from '\.\/xchain\.js'/.test(app));
    for (const [route, fn] of [
      ['/api/xchain/status', 'crossChainStatus'],
      ['/api/xchain/probe', 'crossChainProbe'],
      ['/api/xchain/quotes', 'crossChainQuotes']
    ]) {
      t(`${route} is mounted and calls ${fn}()`,
        new RegExp(`'${route.replace(/\//g, '\\/')}'`).test(app) &&
        new RegExp(`${fn}\\(`).test(app));
    }

    /*
     * The bridge rate is 30 bps, not the 70 bps swap rate. A bridge already
     * carries the provider's own cost; charging our full swap fee on top
     * makes us the expensive option on the easiest trade to price-compare.
     */
    t('the cross-chain fee is the 30 bps bridge rate, not the 70 bps swap rate',
      /CROSSCHAIN_FEE_BPS \?\? 30/.test(c));
  }

  /* ---- 77. coin-page crash, RWA gold, tap-to-pay ------------------------ */
  {
    const code = (src) => src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    /*
     * ═══════════════════════════════════════════════════════════════════════
     * 1. THE COIN PAGE CRASH — A SECOND, DIFFERENT CAUSE.
     * ═══════════════════════════════════════════════════════════════════════
     *   «وقتی وارد بازار نمیشوی و روی یک کوین میزنی کرش میخوره ... بار دوم
     *    خوب میشه»
     *
     * lib/lazyRetry.js fixed the CHUNK failing to load. This is a different
     * bug with the same symptom: the page loads fine, the DATA is missing.
     *
     * resilient() cached the offline fallback for the full 30s TTL. For a coin
     * outside the 50-entry offline snapshot that fallback is `null`, so one
     * rate-limited burst pinned "not found" in place while the network
     * recovered unnoticed. Opening via Market masked it, because the markets
     * list supplied the row from a second source — exactly matching "when you
     * DON'T go into Market first".
     */
    const api = code(read('src/lib/api.js'));
    t('an empty fallback is cached far more briefly than a real answer',
      /EMPTY_TTL_MS/.test(api) && /cached\.empty \? Math\.min\(EMPTY_TTL_MS, ttl\) : ttl/.test(api));
    /*
     * `empty` must be recorded at WRITE time. Re-deriving it on read cannot
     * distinguish a failure from a legitimately empty successful response.
     */
    t('...and emptiness is recorded when written, not guessed when read',
      /empty = data == null \|\| \(Array\.isArray\(data\) && data\.length === 0\)/.test(api));
    t('...and a network failure is remembered rather than swallowed',
      /lastError/.test(api) && /export function lastFetchFailed/.test(api));

    const coin = read('src/pages/CoinDetail.jsx');
    const coinCode = code(coin);
    /*
     * "This coin does not exist" and "the provider was busy" are opposite
     * messages. Only one can be true, and showing the wrong one sends the
     * user away from a page that would have worked.
     */
    t('the coin page tells a rate limit apart from a missing coin',
      /lastFetchFailed\(coinKey\(id\)\)/.test(coinCode));
    t('...with separate copy for each, in both languages', (() => {
      const en = JSON.parse(read('src/i18n/locales/en.json'));
      const fa = JSON.parse(read('src/i18n/locales/fa.json'));
      return hasKey(en, 'coin.tempUnavailable') && hasKey(fa, 'coin.tempUnavailable') &&
             hasKey(en, 'coin.tempUnavailableHelp') && hasKey(fa, 'coin.tempUnavailableHelp');
    })());
    /* Recover without being asked — the second tap already proves it works. */
    t('...and it retries itself once instead of showing an error screen',
      /retriedRef/.test(coinCode) && /invalidate\(coinKey\(id\)\)/.test(coinCode));
    /*
     * invalidate() before refresh is load-bearing: without it the retry reads
     * the cached empty entry and returns instantly, doing nothing.
     */
    t('...and drops the cached empty entry first, or the retry is a no-op',
      /export function invalidate/.test(api));
    /* Retrying one coin must not reload the entire app. */
    t('...and the refresh button no longer reloads the whole page',
      !/window\.location\.reload/.test(coinCode));

    /*
     * ═══════════════════════════════════════════════════════════════════════
     * 2. RWA — ONLY THE ONE CATEGORY WE CAN ACTUALLY SELL.
     * ═══════════════════════════════════════════════════════════════════════
     * Most RWAs are permissioned: BUIDL transfers only between Securitize-
     * approved addresses, OUSG uses a KYC registry. A buy button on those is a
     * button whose transfer reverts. Gold is the exception, and both tokens
     * were quoted live and echoed our 70 bps back before being listed.
     */
    const chains = read('src/lib/chains.js');
    t('tokenised gold is listed with verified mainnet addresses',
      /0x45804880De22913dAFE09f4980848ECE6EcbAf78/.test(chains) &&
      /0x68749665FF8D2d112Fa859AA293F07A622782F38/.test(chains));
    t('...and XAUt carries 6 decimals, not the usual 18',
      /XAUt[\s\S]{0,200}?decimals: 6/.test(chains));
    t('...and they are flagged as RWA so the disclosure can find them',
      /rwa: 'gold'/.test(chains));
    /* No permissioned token may be listed — its transfer would simply revert. */
    t('...and no KYC-gated RWA is listed, whose transfers would revert',
      !/BUIDL|OUSG|BENJI/.test(code(chains)));

    const swap = read('src/pages/Swap.jsx');
    t('the swap screen warns that gold tokens can be frozen by their issuer',
      /rwaFreezeNotice/.test(code(swap)));
    t('...only when a gold token is actually selected',
      /\(fromToken\?\.rwa \|\| toToken\?\.rwa\)/.test(code(swap)));
    t('...and says so in both languages', (() => {
      const en = JSON.parse(read('src/i18n/locales/en.json'));
      const fa = JSON.parse(read('src/i18n/locales/fa.json'));
      return hasKey(en, 'swap.rwaFreezeNotice') && hasKey(fa, 'swap.rwaFreezeNotice');
    })());

    /*
     * ═══════════════════════════════════════════════════════════════════════
     * 3. TAP TO PAY — PROXIMITY MOVES AN ADDRESS, NEVER MONEY.
     * ═══════════════════════════════════════════════════════════════════════
     * Phone-to-phone NFC does not exist any more: Android Beam was removed in
     * Android 14, and Web NFC reads passive tags only. So the tap fills in a
     * destination and the wallet still authorises the transfer.
     *
     * That is a SECURITY boundary, not a platform limitation to be worked
     * around: a payment triggered by proximity alone is a robbery mechanism.
     */
    const tapLib = existsSync('src/lib/tapToPay.js') ? read('src/lib/tapToPay.js') : '';
    t('src/lib/tapToPay.js exists', Boolean(tapLib));
    const tapCode = code(tapLib);
    t('nothing in the tap path signs or sends a transaction',
      !/signTransaction|sendTransaction|eth_sendTransaction/.test(tapCode));
    t('the pay link uses EIP-681, which other wallets already understand',
      /ethereum:\$\{address\}/.test(tapCode));
    /* A single read, then stop: a second tag must not silently swap the payee. */
    t('the scan stops after the first valid read',
      /if \(done\) return;/.test(tapCode) && /ctrl\.abort\(\)/.test(tapCode));
    /* "Unsupported" is useless to an iPhone user who cannot fix it. */
    t('an unsupported browser is explained by REASON, not just refused',
      /IOS_UNSUPPORTED/.test(tapCode) && /DESKTOP_UNSUPPORTED/.test(tapCode));

    const tapUi = existsSync('src/components/TapToPay.jsx') ? read('src/components/TapToPay.jsx') : '';
    t('the TapToPay component exists', Boolean(tapUi));
    t('...and P2P actually renders it',
      /<TapToPay/.test(code(read('src/pages/P2P.jsx'))));
    t('...and it stops the NFC radio when unmounted',
      /abortRef\.current\?\.abort\(\)/.test(code(tapUi)));
    t('...and states plainly that nothing has been sent yet',
      /nothingSentYet/.test(code(tapUi)));

    /*
     * The revenue half. `recipient` delivers a SWAP straight to the other
     * person, so our normal 0.70% applies to real work. Verified live:
     * integratorFee 70000 on a 10 USDC sell with recipient set.
     */
    const gasless = code(read('server/gasless.js'));
    t('recipient is forwarded so a swap can be delivered to the other person',
      /'recipient'/.test(gasless));
    t('...and is validated, since a typo here is an unrecoverable transfer',
      /BAD_RECIPIENT/.test(gasless));
    /* The fee fields must STILL be server-side only. */
    t('...but the fee fields are still not caller-settable',
      !/'swapFeeRecipient'|'swapFeeBps'/.test(
        /const ALLOWED = \[[^\]]*\]/.exec(gasless)?.[0] ?? ''));
    /* Same token = no swap = no fee. Charging one would be taking money for nothing. */
    t('a same-token transfer is not charged a swap fee',
      /mode: 'transfer', earns: false, feeBps: 0/.test(tapCode));
  }

  /* ---- 78. tap-to-pay styling, and the revenue readiness report --------- */
  {
    const code = (src) => src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    /*
     * ═══════════════════════════════════════════════════════════════════════
     * 1. THE NFC BUTTONS WERE UNSTYLED, NOT BADLY STYLED.
     * ═══════════════════════════════════════════════════════════════════════
     *   «دکمه های nfc طوسی شکل اندازه و رنگ نامناسب دارند و کارایی کمی دارند»
     *
     * Grey, wrong size, wrong colour, and does little. One root cause: the
     * component used className="seg" / "seg-on", which exist in no stylesheet.
     * The real control is `.segmented` + `.active` + <SegIndicator>. A misspelt
     * class produces no error anywhere — CSS has no unknown-selector failure
     * and the build does not care — so it shipped looking broken.
     */
    const tap = read('src/components/TapToPay.jsx');
    const tapCode = code(tap);
    t('tap-to-pay uses the real segmented control',
      /className="segmented"/.test(tapCode));
    t('...with the real active class, not an invented one',
      /className=\{mode === k \? 'active' : ''\}/.test(tapCode));
    t('...and renders the selection pill every other control renders',
      /<SegIndicator/.test(tapCode));
    t('...and announces the selection to a screen reader',
      /aria-pressed/.test(tapCode));

    /*
     * "Does little" was the fair half of the complaint. The receive side
     * printed the link as TEXT for the other person to read off a screen and
     * retype — the exact 42-character transcription this feature exists to
     * remove, and the one mistake an on-chain transfer cannot undo.
     *
     * This repo already ships a QR generator (ReceiveSheet) and a QR scanner
     * (QrScanner, on the WebView's native BarcodeDetector). Both sat unused
     * while iPhone users — who cannot use NFC at all — were told to "use the
     * code" that was never rendered.
     */
    t('the receive side renders a real scannable QR, not just text',
      /qrcode\(0, 'M'\)/.test(tapCode) && /<svg/.test(tapCode));
    t('...on a white plate, since scanners need dark modules on light',
      /background: '#fff'/.test(tapCode));
    t('the pay side can open the real camera scanner',
      /<QrScanner/.test(tapCode) && /tap\.scanCode/.test(tapCode));
    /*
     * Scanning must come FIRST. NFC reaches ~6% of browsers and no iPhone, so
     * leading with it puts the unusable option in front of almost everyone.
     */
    t('...and scanning is the primary action, with NFC as the secondary one',
      tapCode.indexOf('tap.scanCode') < tapCode.indexOf('tap.startScan'));
    t('...and the copy button exists for the case where neither is convenient',
      /navigator\.clipboard\.writeText/.test(tapCode));

    /*
     * ═══════════════════════════════════════════════════════════════════════
     * 2. THE P2P FEE, PROVEN RATHER THAN CLAIMED.
     * ═══════════════════════════════════════════════════════════════════════
     * Asked to be sure it really earns. Verified by decoding the signable
     * transaction from a live /api/gasless/quote with recipient set to an
     * address that was NOT the payer:
     *
     *   recipient of the swap : 0x1111…1111
     *   fee transfer (a9059cbb) destination : 0xaf5ce154…24d6   <- our wallet
     *   bps field 0x46 = 70
     *
     * So the payee receives the bought token and we receive 70 bps, in one
     * signed transaction. The guards that make that true are pinned here.
     */
    const gasless = code(read('server/gasless.js'));
    t('recipient reaches the upstream, or the payee never gets paid',
      /'recipient'/.test(gasless));
    t('...and a malformed one is refused, since a wrong address is final',
      /BAD_RECIPIENT/.test(gasless) && /\^0x\[a-fA-F0-9\]\{40\}\$/.test(gasless));

    /*
     * ═══════════════════════════════════════════════════════════════════════
     * 3. THE ZERO-COST PREPARATION, MADE CHECKABLE.
     * ═══════════════════════════════════════════════════════════════════════
     * Every remaining revenue line was already code-complete and waiting on a
     * payment. What was missing was any way for the owner — who works from a
     * phone and cannot read source — to VERIFY that, having been told "just
     * set the variable" for five different features.
     */
    const rd = existsSync('server/readiness.js') ? read('server/readiness.js') : '';
    t('server/readiness.js exists', Boolean(rd));
    const rdCode = code(rd);
    t('the readiness route is mounted and calls it',
      /'\/api\/revenue\/readiness'/.test(code(read('server/app.js'))) &&
      /revenueReadiness\(/.test(code(read('server/app.js'))));
    /*
     * `ready` and `live` must stay separate. Collapsing them hides the entire
     * finding: the remaining work is a purchase, not a build.
     */
    t('...and it separates "code is ready" from "we are earning"',
      /allRemainingAreCodeComplete/.test(rdCode) && /live:/.test(rdCode) && /ready:/.test(rdCode));
    t('...and never echoes a configured value, only whether it is set',
      !/value:|env\(k\)\s*\}/.test(rdCode) && /Boolean\(env\(/.test(rdCode));
    /* Each waiting line must name the exact variable that switches it on. */
    for (const v of ['VITE_GMX_REF_CODE', 'THOR_NAME', 'VITE_FBT_VAULT_ADDRESS', 'VITE_AFFILIATE_TREZOR']) {
      t(`readiness names ${v} as the switch`, new RegExp(v).test(rdCode));
    }
    /*
     * And those variables must genuinely be read by the feature, or the report
     * is a comforting lie. This is the "wired to nothing" check applied to the
     * readiness report itself.
     */
    t('...and every named switch is actually read by its feature',
      /env\('VITE_GMX_REF_CODE'\)/.test(code(read('src/lib/venueReferral.js'))) &&
      /process\.env\.THOR_NAME/.test(code(read('server/thorchain.js'))) &&
      /env\('VITE_FBT_VAULT_ADDRESS'\)/.test(code(read('src/lib/vault.js'))) &&
      /VITE_AFFILIATE_TREZOR/.test(code(read('src/lib/hardware.js'))));
  }

  /* ---- 79. thor destination, laptop nav, send percentages, arrival ------ */
  {
    const code = (src) => src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    /*
     * ═══════════════════════════════════════════════════════════════════════
     * 1. THE BRIDGE ERROR WAS A LIE, TWICE OVER.
     * ═══════════════════════════════════════════════════════════════════════
     * Reported: pick two assets, start typing a destination, and every token
     * shows "no price for this pair — the pool may be shallow".
     *
     * Reproduced against production, which returned the real reasons:
     *   destination=bc1q2nf -> "bad destination address: unable to parse"
     *   0x… address for a BTC payout -> "not the same chain as the target asset"
     * Neither is about pool depth. The panel sent the address on EVERY
     * keystroke, so the error was permanent while typing.
     */
    const addr = existsSync('src/lib/thorAddress.js') ? read('src/lib/thorAddress.js') : '';
    t('src/lib/thorAddress.js exists', Boolean(addr));
    const addrCode = code(addr);
    /* The four states must stay distinct: only one of them is an error. */
    for (const st of ['incomplete', 'wrong-chain', 'empty', 'ok']) {
      t(`destination state '${st}' is distinguished`, new RegExp(`'${st}'`).test(addrCode));
    }
    t('...and upstream wording is mapped to real causes, not one catch-all',
      /DEST_WRONG_CHAIN/.test(addrCode) && /CHAIN_HALTED/.test(addrCode) &&
      /AMOUNT_TOO_SMALL/.test(addrCode));

    const thorPanel = code(read('src/components/ThorPanel.jsx'));
    t('the panel no longer sends a half-typed address',
      /shouldSendDestination\(destination, to\)/.test(thorPanel));
    t('...and a complete wrong-chain address is caught before any request',
      /destState === 'wrong-chain'/.test(thorPanel));
    t('...and errors are classified from the upstream text',
      /classifyQuoteError\(e\.detail\)/.test(thorPanel));
    /* The detail must survive the fetch wrapper or classification has nothing
       to read — this is the link that made all errors look identical. */
    t('...and the client keeps that upstream detail instead of discarding it',
      /err\.detail = body\?\.detail/.test(code(read('src/lib/thorswap.js'))));
    t('...and the expected address format is shown before the mistake',
      /addressHintFor\(to\)/.test(thorPanel));

    /*
     * ═══════════════════════════════════════════════════════════════════════
     * 2. HALF THE BOTTOM MENU ON A LAPTOP.
     * ═══════════════════════════════════════════════════════════════════════
     * The base rule centres the nav with `left:50%` + `translateX(-50%)`. The
     * wide-screen rules switched to margin-based centring but the TRANSFORM
     * survived, pushing the bar half its own width off centre.
     *
     * Worse, `nav-float` baked `translateX(-50%)` into every keyframe, and an
     * animation beats a plain declaration — so `transform: none` in the media
     * query was overwritten every frame. Centring now lives in `translate`,
     * an independent property the animation does not touch.
     */
    const css = read('src/index.css');
    const navRule = /\.bottom-nav \{[\s\S]*?\n\}/.exec(css)?.[0] ?? '';
    t('the nav centres with `translate`, not `transform`',
      /translate: -50% 0/.test(navRule) && !/transform: translateX\(-50%\)/.test(navRule));
    {
      const kf = /@keyframes nav-float \{[\s\S]*?\n\}/.exec(css)?.[0] ?? '';
      t('...and the float animation no longer re-centres it every frame',
        Boolean(kf) && !/translateX/.test(kf));
    }
    t('...so wide screens can clear it (both breakpoints)',
      (css.match(/translate: none;/g) ?? []).length >= 2);
    /*
     * A laptop is WIDE but SHORT. The only compact rule was
     * `max-height: 480px and orientation: landscape`, written for a phone on
     * its side, which a 768px-tall laptop never matches — so it got full
     * phone spacing on a screen that cannot afford it.
     */
    t('short viewports get a compact nav, which laptops previously missed',
      /@media \(max-height: 720px\) and \(min-width: 700px\)/.test(css));

    /*
     * ═══════════════════════════════════════════════════════════════════════
     * 3. AMOUNT, ASSET, AND THE RECEIVER'S CONFIRMATION.
     * ═══════════════════════════════════════════════════════════════════════
     */
    const send = code(read('src/components/SendSheet.jsx'));
    t('the send sheet lets the user choose WHICH asset',
      /setTokenSym/.test(send) && /send\.asset/.test(send));
    t('...and offers 25/50/75/100 as well as a typed amount',
      /\[25, 50, 75, 100\]/.test(send));
    /*
     * 100% must route through setMax(), which reserves gas on a native coin.
     * A plain x1 would build a transfer of the entire balance, which cannot
     * be mined — a button that always fails.
     */
    t('...and 100% reserves gas instead of sending the literal whole balance',
      /if \(pct >= 100\) return setMax\(\)/.test(send));
    t('...and changing asset clears a figure typed for the previous one',
      /setTokenSym\((e\.target\.value|tk\.symbol)\);[\s\S]{0,80}setAmount\(''\)/.test(send));

    const watch = existsSync('src/lib/incomingWatch.js') ? read('src/lib/incomingWatch.js') : '';
    t('src/lib/incomingWatch.js exists', Boolean(watch));
    const watchCode = code(watch);
    /* The first read is the reference point. Treating it as an arrival would
       fire immediately for anyone who already holds the token. */
    t('the first balance read is a baseline, never an arrival',
      /if \(baseline == null\)/.test(watchCode));
    t('...and a failed read is ignored rather than reported as zero',
      /if \(now == null\) return/.test(watchCode));
    t('...and a spend elsewhere re-baselines instead of under-reporting later',
      /now < baseline/.test(watchCode));
    t('...and it stops, so it cannot poll forever in the background',
      /return \(\) => \{[\s\S]{0,120}clearInterval/.test(watchCode));

    const pop = existsSync('src/components/ArrivalPopup.jsx') ? read('src/components/ArrivalPopup.jsx') : '';
    t('the arrival popup exists', Boolean(pop));
    t('...and TapToPay mounts it', /<ArrivalPopup/.test(code(read('src/components/TapToPay.jsx'))));
    /*
     * Centred by FLEXBOX. Motion animates `scale` and writes its own
     * transform, so a translate-based centring would be erased and the card
     * would drop to a corner — the bug already shipped twice here.
     */
    {
      const bd = /\.arrival-backdrop \{[\s\S]*?\n\}/.exec(css)?.[0] ?? '';
      t('...centred with flexbox, not a transform Motion would overwrite',
        /align-items: center/.test(bd) && /justify-content: center/.test(bd) &&
        !/translate\(-50%/.test(bd));
    }
    t('...and is themed with variables so light mode is not broken',
      /var\(--bg-panel-solid\)/.test(read('src/index.css')) &&
      /data-theme='light'\] \.arrival-tick/.test(css));
    t('the tap box is collapsible, as asked',
      /<InfoBox title=\{t\('tap\.title'\)\}/.test(code(read('src/pages/P2P.jsx'))));
    t('...and states plainly whether NFC works on this device',
      /tap\.nfcYes/.test(code(read('src/components/TapToPay.jsx'))));

    /*
     * ═══════════════════════════════════════════════════════════════════════
     * 4. REVENUE: STAKING AND A DEAD SETTING.
     * ═══════════════════════════════════════════════════════════════════════
     * Farm reads yields from DefiLlama and links OUT — we do the work and
     * somebody else takes the transaction. Buying stETH IS staking, so the
     * same outcome can go through our own swap at the normal fee. Both were
     * quoted live and echoed our fee receiver before being listed.
     */
    const chains = read('src/lib/chains.js');
    t('liquid staking tokens are listed with verified addresses',
      /0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84/.test(chains) &&
      /0xae78736Cd615f374D3085123A210448E74Fc6393/.test(chains));
    t('...and are flagged so Farm can route them in-app', /stake: 'eth'/.test(chains));
    t('Farm offers an in-app staking route instead of only linking away',
      /farm\.ethStakingTitle/.test(code(read('src/pages/Farm.jsx'))));
    /* Addresses must come from the token table, never retyped. */
    t('...and reads the token list rather than duplicating addresses',
      /TOKENS\[1\] \?\? \[\]\)\.filter\(\(tk\) => tk\.stake === 'eth'\)/.test(read('src/pages/Farm.jsx')));
    t('jupSOL is offered, the largest LST we were missing',
      /jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v/.test(read('src/lib/solanaAssets.js')));

    /*
     * The Solana RPC setting was stored, redrawn in the UI from what was
     * stored, and read by nothing — the broadcast path had the public
     * endpoint hard-coded. Same defect the EVM RPC, expertMode and
     * autoLockMinutes each had before they were fixed.
     */
    const swal = code(read('src/lib/solanaWallet.js'));
    t('the Solana RPC setting is actually used, not just stored',
      /st\.solanaRpc/.test(swal) && /solanaCluster === 'devnet'/.test(swal));
    t('...over https only, matching the EVM rule',
      /\^https:\\\/\\\//.test(swal));
  }

  /* ---- 80. the real coin crash, header scale, selects, rwa reachability - */
  {
    const code = (src) => src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    /*
     * ═══════════════════════════════════════════════════════════════════════
     * 1. THE COIN CRASH — THIRD CAUSE, AND THE ONE THAT MATCHED THE REPORT.
     * ═══════════════════════════════════════════════════════════════════════
     * «برای اولین بار هر توکنی را انتخاب کنی کرش میکنه بار دوم خوبه، اگر وارد
     *  یک صفحه دیگر شوی و دوباره برگردی دوباره کرش میکنه»
     *
     * Crashes on FIRST open of ANY token, fine on the second, and CRASHES
     * AGAIN after navigating away and back. That last clause is what ruled
     * out both earlier diagnoses: a poisoned module-map entry and a cached
     * empty response are each permanent for the session, so neither can
     * come back after being fixed.
     *
     * The real cause: `verdict({ coin = {} })`. A default parameter fires
     * only for `undefined`, never for `null`. On a cold open the chart
     * request often resolves before the coin request, so CoinDetail has
     * `loading === false` while `coin` is still null, its not-found guard
     * does not fire (the coin fetch is still in flight), and it renders
     * <VerdictPanel coin={null}> straight into a destructure of null.
     *
     * Second tap works because getCoin is memoised by then. Leaving and
     * returning re-runs the same cold race — exactly the reported shape.
     *
     * Verified by removing the guards and watching the throw return.
     */
    for (const [file, fn] of [
      ['src/lib/verdict.js', 'verdict'],
      ['src/lib/macro.js', 'macroContext'],
      ['src/lib/localOutlook.js', 'localOutlook'],
      ['src/lib/ai.js', 'analyze']
    ]) {
      const src = code(read(file));
      t(`${fn}() normalises a null coin, which a default parameter cannot`,
        /coin = coinArg \?\? \{\}/.test(src));
      /* The old signature must be gone, not merely shadowed. */
      t(`...and ${fn}() no longer relies on \`coin = {}\``,
        !/\bcoin = \{\}(?!\s*;)/.test(src.replace(/coinArg = \{\}/g, '')));
    }
    /*
     * The coin page used to need an `analysisReady` guard here, because it
     * rendered a VerdictPanel and a null coin crashed it. That panel now lives
     * only on Signals, so the guard is gone with the thing it guarded — and
     * the crash it prevented is now impossible rather than handled.
     *
     * Asserted so nothing quietly re-introduces the render without the guard.
     */
    t('the coin page no longer renders an analysis it must guard',
      !/analysisReady/.test(code(read('src/pages/CoinDetail.jsx'))));

    /*
     * ═══════════════════════════════════════════════════════════════════════
     * 2. RWA WAS UNREACHABLE, NOT UNPROFITABLE.
     * ═══════════════════════════════════════════════════════════════════════
     * «الان توکن rwa هم نمیشه درامد زایی کرد»
     *
     * The tokens were listed, routable and fee-paying — a live quote echoed
     * our receiver. But every link to them is `?chain=1&from=USDT&to=PAXG`,
     * and the SYMBOL prefill never read `?chain=`: it matched against
     * `curated`, which is the list FOR THE CURRENT CHAIN. On any chain but
     * Ethereum the symbol matched nothing and the prefill failed silently.
     *
     * The ADDRESS prefill had always handled this. The symbol path was just
     * never given the same treatment, which also silently broke the new Farm
     * staking links.
     */
    const swap = code(read('src/pages/Swap.jsx'));
    /* Both prefills must switch chain — hence two occurrences. */
    t('the symbol prefill honours ?chain=, so an off-chain token is reachable',
      (swap.match(/const wantedChain = Number\(searchParams\.get\('chain'\)\)/g) ?? []).length === 2);
    t('...and switches rather than matching against the wrong chain list',
      (swap.match(/wallet\.switchChain\?\.\(wantedChain\)/g) ?? []).length === 2);
    /* chainId must be a dependency or the effect never re-runs after switching. */
    t('...and re-runs once the chain has changed',
      /\}, \[searchParams, setSearchParams, curated, chainId, wallet\]\)/.test(swap));
    t('the generic chain reset cannot overwrite a pending deep-link token',
      /searchParams\.get\('from'\).*searchParams\.get\('to'\).*searchParams\.get\('toAddress'\)/s.test(swap));
    t('Ostium hands Swap the Arbitrum USDC pair explicitly',
      /swap\?chain=42161&to=USDC/.test(read('src/pages/Ostium.jsx')));

    /*
     * ═══════════════════════════════════════════════════════════════════════
     * 3. HEADER AND SELECTS ON DESKTOP.
     * ═══════════════════════════════════════════════════════════════════════
     */
    const css = read('src/index.css');
    /*
     * Everything in the header was a fixed phone value while the column grew
     * from 520 to 760px, so it read as a caption rather than a title.
     */
    t('the header scales with the column at every wide breakpoint',
      /\.brand-name \{ font-size: 16\.5px; \}/.test(css) &&
      /\.brand-name \{ font-size: 18\.5px; \}/.test(css) &&
      /\.brand-name \{ font-size: 20px; \}/.test(css));
    t('...and the mark and buttons grow with it, not just the text',
      /\.brand-mark \{ width: 38px/.test(css) && /\.icon-btn \{ min-width: 42px/.test(css));

    /*
     * A themed box around an unthemed control: without `appearance: none` the
     * browser keeps its own widget — a grey system arrow on Chrome, a full
     * bevelled control on desktop Firefox and Safari — inside our dark
     * rounded field. That is the reported «بسیار ساده است».
     */
    t('selects drop the browser widget and draw their own arrow',
      /select \{[\s\S]{0,400}?appearance: none/.test(css) &&
      /background-image: url\("data:image\/svg\+xml/.test(css));
    /* A <select> is a replaced element; a ::after arrow is unreliable on it. */
    t('...via background-image, since a select cannot host a pseudo-element',
      !/select::after/.test(css));
    t('...with an arrow that flips for right-to-left',
      /\[dir='rtl'\] select \{ background-position: left/.test(css));
    t('...and a light-theme arrow, since the dark one vanishes on white',
      /data-theme='light'\] select \{/.test(css));
    t('...and an option list that is dark on the dark theme',
      /select option \{[\s\S]{0,120}color: #e8ecf4/.test(css));

    /* Bridge adds a more specific select class after the global rule. A
       `background` or `padding` shorthand there silently erased both the
       custom chevron and the space reserved for it. */
    const uncommentedCss = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const bridgeSelect = /\.brg-select\s*\{[^}]*\}/.exec(uncommentedCss)?.[0] ?? '';
    t('bridge selects preserve the global chevron and its reserved space',
      /background-color:\s*var\(--bg-raised\)/.test(bridgeSelect) &&
      !/(?:^|[;\s])background\s*:/.test(bridgeSelect) &&
      /padding-inline-end:\s*34px/.test(bridgeSelect));
    t('bridge selects use an opaque, native-light surface in the light theme',
      /:root\[data-theme='light'\] \.brg-select\s*\{[^}]*background-color:\s*#ffffff[^}]*color-scheme:\s*light/.test(uncommentedCss));

    /* The swap stylesheet is route-scoped and therefore cannot be inferred
       from index.css. Its dark smoked field must have an explicit light-mode
       replacement rather than leaking black alpha onto a white ticket. */
    const labCss = read('src/styles/lab-modern.css').replace(/\/\*[\s\S]*?\*\//g, '');
    t('the light swap amount field has a clean white-tinted surface',
      /:root\[data-theme='light'\] \.swap-ticket \.swap-field\s*\{[^}]*background:[^}]*#ffffff/.test(labCss));
    t('the light swap amount input does not draw a second grey box',
      /:root\[data-theme='light'\] \.swap-ticket \.swap-field > input\s*\{[^}]*background:\s*transparent[^}]*border-color:\s*transparent[^}]*box-shadow:\s*none/.test(labCss));
  }

  /* ---- 81. price alerts, and Velora as a third keyless source ----------- */
  {
    const code = (src) => src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    /*
     * ═══════════════════════════════════════════════════════════════════════
     * 1. FAVOURITE-COIN PRICE ALERTS DID NOT EXIST.
     * ═══════════════════════════════════════════════════════════════════════
     * Asked to confirm notifications work for news, favourite price moves and
     * automatic orders. Audited each by counting consumers OUTSIDE notify.js:
     *
     *   news        9 consumers  -> works
     *   tradeAlerts 2 consumers  -> works
     *   priceAlerts 0 consumers  -> DID NOT EXIST
     *
     * The switch was in Settings, the app remembered it, and nothing anywhere
     * ever compared a price. Same "wired to nothing" shape as the dead Solana
     * RPC setting, except this one silently promises to warn about money.
     */
    const pa = existsSync('src/lib/priceAlerts.js') ? read('src/lib/priceAlerts.js') : '';
    t('src/lib/priceAlerts.js exists', Boolean(pa));
    const paCode = code(pa);
    t('the priceAlerts switch is finally read by something',
      /settings\?\.priceAlerts/.test(paCode));
    /* A first sighting must record, never fire — or enabling the feature
       would alert for every favourite at once. */
    t('a first sighting records a baseline instead of alerting',
      /if \(!prev \|\| !Number\.isFinite\(prev\.base\)/.test(paCode));
    /*
     * `at` must mean "last ALERTED", not "last seen". It first got a stamp
     * when the baseline was recorded, so a coin's very first genuine alert
     * was swallowed by its own cooldown. Found by stepping a simulated price
     * through the function; the code read correctly.
     */
    t('...and the cooldown cannot swallow the first real alert',
      /prev\.at != null && now - prev\.at < cooldownMs/.test(paCode) &&
      /next\[coin\.id\] = \{ base: price \};/.test(paCode));
    /* Number(null) is 0 and 0 is finite, so the positivity test must lead. */
    t('...and a null price cannot become a zero baseline',
      /!Number\.isFinite\(price\) \|\| price <= 0/.test(paCode));
    t('...and unstarring a coin drops its baseline',
      /if \(!starred\.has\(id\)\) delete next\[id\]/.test(paCode));
    /* Wording must be translated by the caller, never decided in the lib. */
    t('...and the library never writes user-facing copy itself',
      !/'[A-Z][a-z]+ (is|moved|went)/.test(paCode));

    const market = code(read('src/pages/Market.jsx'));
    t('Market runs the check on data it already polls',
      /runPriceAlerts\(/.test(market));
    t('...and passes translated copy in', /notify\.price\.up/.test(market));
    {
      const en = JSON.parse(read('src/i18n/locales/en.json'));
      const fa = JSON.parse(read('src/i18n/locales/fa.json'));
      const ar = JSON.parse(read('src/i18n/locales/ar.json'));
      t('...translated in all three written languages',
        ['notify.price.title', 'notify.price.up', 'notify.price.down']
          .every((k) => hasKey(en, k) && hasKey(fa, k) && hasKey(ar, k)));
    }

    /*
     * ═══════════════════════════════════════════════════════════════════════
     * 2. VELORA — THE ONE AGGREGATOR ON THE SHORTLIST THAT WORKS.
     * ═══════════════════════════════════════════════════════════════════════
     * Every other candidate was tested live and rejected: 1inch, 0x, OKX DEX,
     * SimpleSwap and StealthEX each demand a key, and SimpleSwap's own terms
     * name Iran. Velora answered with a full route and no credentials, and
     * honoured partnerFeeBps=70 as partnerFee 0.7 under a partner name we
     * invented on the spot.
     */
    const vel = existsSync('src/lib/velora.js') ? read('src/lib/velora.js') : '';
    t('src/lib/velora.js exists', Boolean(vel));
    const velCode = code(vel);
    /*
     * Their DEFAULT parks fees in a FeeClaimer the partner must later claim
     * from — an extra Ethereum transaction we would pay for. Direct transfer
     * is the only thing that makes 70 bps worth collecting.
     */
    t('the fee goes straight to our wallet, not into a claim contract',
      /isDirectFeeTransfer', 'true'/.test(velCode) && /takeSurplus', 'true'/.test(velCode));
    /*
     * Reading destAmount when a fee was requested would overstate the output
     * by exactly our fee and hand Velora wins it did not earn.
     */
    t('...and the after-fee amount is read, so it cannot win unfairly',
      /data\.destAmountAfterFee \?\? data\.destAmount/.test(velCode));
    t('...and it is quote-only until it proves itself',
      /executable: false/.test(velCode));
    t('...on a short leash so a third source cannot slow the quote',
      /TIMEOUT_MS = 3000/.test(velCode));
    t('swap.js actually asks it', /getVeloraQuote\(common\)/.test(code(read('src/lib/swap.js'))));
    /* The integrator name must match LI.FI's, or analytics split in two. */
    t("...under the same partner name as everywhere else",
      /VELORA_PARTNER = 'fbtswap'/.test(velCode));
  }

  /* ---- 82. UTEX, and the shape of the API audit ------------------------- */
  {
    const code = (src) => src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    /*
     * UTEX was the only broker on the shortlist that survived. Every other
     * one — Alpaca, Public.com, Kraken — settles through the banking system
     * and needs a W-8BEN, and OFAC FAQ 54 says an account with a W-8 showing
     * Iran should be treated as restricted. UTEX settles entirely in USDT and
     * its own partner guide says access holds "no matter where they live".
     */
    const vr = code(read('src/lib/venueReferral.js'));
    t('UTEX is wired as an earning venue', /utex: \{/.test(vr) && /UTEX_CAMPAIGN/.test(vr));
    t('...using their campaignId parameter, not an invented one',
      /param: 'campaignId'/.test(vr));
    /*
     * It must be the ONLY earning venue with userBenefit false. GMX and
     * Avantis both discount the referee's fees; UTEX offers a bonus that a
     * manager has to activate, which we cannot promise on their behalf.
     */
    t('...and does not claim a user benefit we cannot guarantee',
      /userBenefit: false,\s*param: 'campaignId'/.test(vr));
    /*
     * The code validator must be shared, or a malformed id earns nothing.
     *
     * This used to match the inline ternary inside `withReferral`. That
     * ternary was extracted into `referralCodeFor` when a bug was found in
     * its twin — `venueDisclosure` had its own copy that only ever checked
     * GMX, so any other venue would have earned while reporting that it did
     * not. The check now asserts the shared lookup covers UTEX, which is the
     * property that actually matters and survives the next refactor.
     */
    t('...and its id runs through the same validator as the others',
      /referralCodeFor/.test(vr) && /venueId === 'utex'\) return UTEX_CAMPAIGN/.test(vr));

    /*
     * The risk disclosure is not optional. UTEX holds no broker licence and
     * its "stocks" are USDT margin positions, which is a materially different
     * product from the tokenised equities this app sells backed 1:1 by real
     * shares. The two must not blur together.
     */
    t('the env file states UTEX holds no broker licence',
      /holds NO broker licence/.test(read('.env.example')));

    /* Readiness must list every new line, or the report quietly lies. */
    const rd = read('server/readiness.js');
    for (const id of ['velora', 'avantis', 'utex']) {
      t(`readiness reports ${id}`, new RegExp(`id: '${id}'`).test(rd));
    }
    t('...and still separates code-readiness from earning',
      /allRemainingAreCodeComplete/.test(rd));
  }

  /* ---- 83. The one to-do list, and the claims inside it ------------------ */
  {
    /*
     * ─── WHY THIS SECTION EXISTS ────────────────────────────────────────────
     * Asked for one step-by-step list, with links, of everything still
     * outstanding. Fifty-odd Persian docs already exist and the owner cannot
     * be expected to know which is current — so there is now exactly ONE
     * index, and these checks stop it from rotting into the same problem.
     *
     * What is checked is deliberately narrow: that the file exists, that it
     * still points at the live readiness endpoint rather than a hard-coded
     * count that will drift, and that the two facts most likely to cost real
     * money if they were lost are still spelled out.
     */
    t('the single step-by-step to-do list exists',
      existsSync('docs/TODO-STEP-BY-STEP-FA.md'));
    const todo = existsSync('docs/TODO-STEP-BY-STEP-FA.md')
      ? read('docs/TODO-STEP-BY-STEP-FA.md')
      : '';

    /*
     * The live endpoint, not a number typed into prose. Every previous doc
     * baked in "8 of 16" and every one of them is now wrong or soon will be.
     */
    t('...and sends the owner to the live readiness endpoint',
      /api\/revenue\/readiness/.test(todo));

    /*
     * The GMX code is case-sensitive on-chain. Registering `FBTSwap` when the
     * app sends `fbtswap` earns zero forever and cannot be undone, so the
     * warning has to survive in the doc the owner actually follows.
     */
    t('...and warns that the GMX code is case-sensitive',
      /fbtswap/.test(todo) && /GMX/.test(todo)
      && /(case-sensitive|حساس)/i.test(todo));

    /*
     * Rotating the Firebase service-account key outranks every revenue line
     * in this file: it is full admin on the whole database. It must be first.
     */
    t('...and puts the Firebase key rotation before the revenue work',
      todo.indexOf('serviceaccounts') > -1
      && todo.indexOf('serviceaccounts') < todo.indexOf('app.gmx.io'));

    /*
     * deBridge needs no key and no signup, and was first written up here at
     * 70 bps because that is more than double what LI.FI pays us. Quoting both
     * providers side by side proved 70 bps leaves the USER worse off than the
     * bridge we already had, so the rate is 40.
     *
     * This check pins the CORRECTION, not the original finding. A doc that
     * still advertises 70 bps would send the next person to re-raise the rate
     * and undo the only thing that made this route honest.
     */
    t('...and records the deBridge correction, not the original 70 bps claim',
      /deBridge/.test(todo) && /۰٫۴٪/.test(todo) && /۰٫۷٪/.test(todo));

    /*
     * The blocked list has to stay, or the same dead ends get re-researched.
     * OFAC FAQ 54 is the single citation that explains most of them.
     */
    t('...and keeps the blocked-platform evidence', /OFAC FAQ 54/.test(todo));
  }

  /* ---- 84. deBridge DLN, and the fee rate the comparison forced ---------- */
  {
    /*
     * ─── WHAT THIS SECTION IS REALLY GUARDING ───────────────────────────────
     * Not "does the file exist". The dangerous thing about this integration is
     * that it pays us more than the bridge we already had, which makes the
     * greedy choice feel like the obvious one. Quoting both providers at the
     * same amount in the same minute showed that at 0.7% the user ends up $25
     * worse off on a $10,000 transfer than on LI.FI — we would have shipped a
     * route that was better for us and worse for them, and the output amount
     * alone would never have revealed it.
     *
     * So these checks pin the RATE and the REASONING, because a future edit
     * that "optimises" 0.4 back up to 0.7 would look like a revenue win in a
     * diff and would silently be a betrayal of the user.
     */
    const dlnSrv = existsSync('server/dln.js') ? read('server/dln.js') : '';
    t('the deBridge server module exists', dlnSrv.length > 0);

    /*
     * Comments are stripped FIRST. This suite has been fooled six times by
     * checks that matched their own explanatory prose, most memorably on the
     * very commit that added the undefined-CSS-class check.
     *
     * `code` is redeclared here rather than reused: it is `const` inside each
     * section's block, so referring to a sibling block's copy is a
     * ReferenceError at run time, not a lint warning.
     */
    const code = (src) => src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    const dlnCode = code(dlnSrv);

    t('...and asks for 0.4%, not the 0.7% that loses to LI.FI',
      /\?\?\s*0\.4/.test(dlnCode) && /return 0\.4/.test(dlnCode));

    /*
     * The clamp matters as much as the default: deBridge accepts far more than
     * 1% and a stray keystroke taking 7% of a bridge is unrecoverable.
     */
    t('...and clamps the rate so a typo cannot take a huge cut',
      /raw\s*<\s*0\s*\|\|\s*raw\s*>\s*1/.test(dlnCode));

    /*
     * The measured table is the evidence for the rate. Without it the next
     * person sees an arbitrary-looking 0.4 next to a competitor paying 0.7 and
     * "fixes" it.
     */
    t('...and keeps the measured evidence for why 0.4 and not 0.7',
      /9,949\.74/.test(dlnSrv) && /9,919\.76/.test(dlnSrv));

    /*
     * The affiliate parameters must be set server-side. This is the same
     * boundary as server/bridge.js: a caller who could supply them would
     * redirect our commission by editing a query string.
     */
    t('...and sets the affiliate parameters itself',
      /affiliateFeeRecipient:\s*dlnFeeRecipient/.test(dlnCode));
    t('...and never reads them from the caller',
      !/query\??\.\[?['"`]?affiliateFee/.test(dlnCode));

    /*
     * The fee is taken on the ORIGIN chain, so a Solana origin needs a Solana
     * address. Returning our EVM address there would be a burn, not a payment
     * — the same family-crossing mistake lib/payout.js exists to prevent.
     */
    t('...and picks a fee address matching the origin chain family',
      /SOLANA_CHAIN/.test(dlnCode) && /TRON_CHAIN/.test(dlnCode));

    /*
     * The fee is read BACK out of the response rather than assumed. Three
     * integrations in this repo looked configured and earned nothing.
     */
    t('...and reads our fee back out of the response',
      /AffiliateFee/.test(dlnCode) && /affiliateFeeFrom/.test(dlnCode));

    /* The routes. A module nobody can reach earns exactly as much as none. */
    const appSrc = code(read('server/app.js'));
    for (const r of ['/api/dln/quote', '/api/dln/tx', '/api/dln/status']) {
      t(`${r} is routed`, appSrc.includes(r));
    }

    /* ---- the client half ---- */
    const dlnLib = existsSync('src/lib/dln.js') ? code(read('src/lib/dln.js')) : '';
    t('the client comparison exists', /export function compareRoutes/.test(dlnLib));

    /*
     * The whole point: no winner is declared when the fixed fee cannot be
     * priced. Comparing "9.94 out" against "9.68 out plus 0.001 ETH you also
     * pay" and picking the bigger number is how the user gets recommended the
     * route that costs them more.
     */
    t('...and refuses to pick a winner when the fixed fee is unpriced',
      /FIXED_FEE_UNPRICED/.test(dlnLib));

    /*
     * `Number(null)` is 0 and 0 is finite. The null guard must come FIRST or a
     * missing fixed fee reads as a free one. Hit before, in priceAlerts.
     */
    t('...and null-checks the fixed fee before any arithmetic',
      /fixFeeUsd\s*==\s*null/.test(dlnLib));
    t('...and rejects a zero or missing transfer total',
      /total\s*<=\s*0/.test(dlnLib));

    /* The Bridge screen has to actually render it and be able to sign it. */
    const brg = code(read('src/pages/Bridge.jsx'));
    t('the bridge screen quotes deBridge too', /getDlnQuote/.test(brg));
    t('...and can execute through it', /getDlnTx/.test(brg));
    /*
     * Default `lifi`. Defaulting to the higher-paying route would make the
     * user's choice a formality and put our revenue ahead of their price.
     */
    t('...and defaults to LI.FI rather than the route that pays us more',
      /useState\('lifi'\)/.test(brg));
    /*
     * The fixed protocol fee travels in tx.value. Dropping it produces a
     * revert that costs gas and explains nothing.
     */
    t('...and forwards the fixed fee in the transaction value',
      /value:\s*order\.tx\.value/.test(brg));
    /*
     * A DLN order is invisible to scan.li.fi. Sending someone there after a
     * successful bridge shows "not found" at the most anxious possible moment.
     */
    t('...and links to the right tracker for each provider',
      /app\.debridge\.finance\/orders/.test(brg));
    /* The severe-burden warning must reach the screen, not just exist. */
    t('...and warns when the fixed fee dwarfs a small transfer',
      /burden\?\.severe/.test(brg));

    /* Copy, in the three locales that actually have a bridge section. */
    for (const lang of ['en', 'fa', 'ar']) {
      const j = JSON.parse(read(`src/i18n/locales/${lang}.json`));
      const b = j.bridge ?? {};
      t(`${lang} names both bridge providers`,
        Boolean(b.provider?.lifi) && Boolean(b.provider?.dln));
      t(`${lang} explains the fixed fee`, Boolean(b.fixedFee) && Boolean(b.fixedFeeWarn));
      t(`${lang} can say the routes are not comparable`, Boolean(b.cannotCompare));
    }

    /* Readiness must list it, or the report the owner reads quietly lies. */
    t('readiness reports the deBridge line', /id: 'bridge-dln'/.test(read('server/readiness.js')));

    /* And the env file must carry the warning, since that is where a rate
       change would actually be made. */
    const envx = read('.env.example');
    t('the env file documents the DLN rate', /DLN_FEE_PERCENT=0\.4/.test(envx));
    t('...and warns that raising it moves the user to the worse side',
      /it moves the user to the worse side/.test(envx));

    /*
     * ─── THE DISCLOSURE BUG FOUND WHILE VERIFYING THE AVANTIS PATH ──────────
     * `venueDisclosure` hard-coded GMX:
     *
     *   isValidGmxCode(venueId === 'gmx' ? GMX_CODE : '')
     *
     * For any other venue that is `isValidGmxCode('')`, always false. So the
     * moment the Avantis code is registered, links would carry it and start
     * earning while the notice on screen still told the user we earn nothing.
     * Wrong in the worst direction: taking a share and denying it.
     *
     * Proven by building the module with the env var set and watching the
     * disclosure flip from 'none' to 'earning' only after the fix.
     */
    const vref = code(read('src/lib/venueReferral.js'));
    t('the referral code lookup is shared, not duplicated per caller',
      /export function referralCodeFor/.test(vref));
    t('...and the disclosure uses it instead of hard-coding GMX',
      /isValidGmxCode\(referralCodeFor\(venueId\)\)/.test(vref));
    t('...so no venue can earn while reporting that it does not',
      !/venueId === 'gmx' \? GMX_CODE : ''/.test(vref));

    /*
     * ─── THE AVANTIS URL, WHICH IS SINGULAR ─────────────────────────────────
     * Their referral page is /referral. I wrote /referrals in the first draft
     * of the owner's guide and checking it live returned "404: This page could
     * not be found" — while the docs site's own page really is /rewards/
     * referrals, which is what made the plural look right.
     *
     * The app itself links to /trade, which is correct and live. This check
     * exists so that "helpfully" changing it to a referral URL later cannot
     * silently introduce the 404, and so the owner's guide keeps the singular.
     */
    const perp = read('src/pages/Perp.jsx');
    t('the Avantis venue link points at a page that exists',
      /avantisfi\.com\/trade/.test(perp) && !/avantisfi\.com\/referrals/.test(perp));

    /*
     * ─── THE PARAMETER BUG: `ref` ON /trade EARNED NOTHING ──────────────────
     * We had `param: 'ref'` for Avantis, copied from the GMX convention
     * without checking. Avantis reads neither `ref` nor anything at all on
     * /trade — after the code was registered its own UI produced
     *
     *     https://www.avantisfi.com/referral?code=fbtswap
     *
     * so both the parameter NAME and the PATH were wrong. The failure is
     * invisible from outside: the link opens a working trading page and
     * attributes the trader to nobody. Pinned as literals, because a generic
     * "has a param" check passes for the broken version too.
     */
    t('Avantis attributes on ?code=, not ?ref=', /param: 'code'/.test(vref));
    t('...and on the /referral page, which is the only one that reads it',
      /base: 'https:\/\/www\.avantisfi\.com\/referral'/.test(vref));
    t('...so the GMX-style ref param is gone from the Avantis entry',
      !/avantis: \{[\s\S]{0,900}?param: 'ref'/.test(vref));
    t('...and withReferral honours a venue base URL', /new URL\(cfg\.base \?\? url\)/.test(vref));

    /*
     * ─── THE CODES ARE COMPILED IN, NOT ONLY ENV VARS ───────────────────────
     * VITE_AVANTIS_REF_CODE and VITE_UTEX_CAMPAIGN_ID are absent from the env
     * block of .github/workflows/build-apk.yml, and the agent token cannot
     * edit workflow files. A value set only in Vercel therefore earns on the
     * website and NOTHING in the APK, because Vite bakes the default in at
     * build time. Both are public identifiers, so committing them leaks
     * nothing.
     */
    t('the registered Avantis code is the compiled default',
      /env\('VITE_AVANTIS_REF_CODE'\) \|\| 'fbtswap'/.test(vref));
    t('the registered UTEX campaign is the compiled default',
      /env\('VITE_UTEX_CAMPAIGN_ID'\) \|\| '517433'/.test(vref));

    /*
     * Readiness must not gate these on a VITE_ variable read from the SERVER
     * process: VITE_ vars are build-time browser values, so the check could
     * report live:false on a build that is provably earning.
     */
    const rdy = code(read('server/readiness.js'));
    t('readiness does not gate Avantis on a build-time browser variable',
      !/live: Boolean\(env\('VITE_AVANTIS_REF_CODE'\)\)/.test(rdy));
    t('...nor UTEX', !/live: Boolean\(env\('VITE_UTEX_CAMPAIGN_ID'\)\)/.test(rdy));

    const av = existsSync('docs/AVANTIS-STEPS-FA.md')
      ? read('docs/AVANTIS-STEPS-FA.md')
      : '';
    t('the Avantis guide exists', av.length > 0);
    t('...and uses the singular /referral that actually loads',
      /avantisfi\.com\/referral\b/.test(av));
    /*
     * Logging in with Google or X gets you a Privy CUSTODIAL wallet, per their
     * own onboarding docs. The referral earnings would land in a wallet we do
     * not hold the keys to. The guide must keep warning about this.
     */
    t('...and warns against the social login that creates a custodial wallet',
      /custodial/i.test(av));
    /* The payout address has to be in the guide, or it cannot be checked. */
    t('...and states the wallet address to connect',
      av.includes('0xaf5CE154cEfd22Da5BD1D0a54479E81963A224d6'));

    /*
     * ─── AVANTIS WITHOUT GAS ────────────────────────────────────────────────
     * The owner could not complete the signature because he had no ETH on
     * Base. Avantis sponsor gas through Gelato, but for an EVM wallet it is
     * OFF unless "Smart Wallet" is toggled at login - social logins get it by
     * default, which is the trap, because a social login creates a Privy
     * CUSTODIAL wallet and our referral code would bind to a wallet we hold
     * no keys for. So the free route and the custodial warning have to travel
     * together; either one alone leads him somewhere wrong.
     */
    t('...and gives the gasless route for a wallet with no ETH',
      /Smart Wallet/.test(av));

    /* ---- where each rotated credential goes -------------------------- */
    const wk = existsSync('docs/WHERE-TO-PUT-KEYS-FA.md')
      ? read('docs/WHERE-TO-PUT-KEYS-FA.md')
      : '';
    t('the key-placement guide exists', wk.length > 0);
    /*
     * The names must be exact. `ALCHEMY_API_KEY` with a VITE_ prefix would be
     * compiled into the browser bundle and leak again - re-leaking the very
     * key being rotated.
     */
    for (const k of ['ALCHEMY_API_KEY', 'GROQ_API_KEY', 'BLOB_READ_WRITE_TOKEN',
      'FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY']) {
      t(`...and names ${k} exactly`, wk.includes(k));
    }
    t('...and warns against the VITE_ prefix on server secrets',
      /VITE_/.test(wk) && /مرورگر/.test(wk));
    /*
     * The \n handling is the single most common cause of a failed rotation,
     * and it fails with `invalid_grant`, which names nothing.
     */
    t('...and explains the private-key newline trap',
      /invalid_grant/.test(wk));
    t('...and tells him to delete the downloaded JSON afterwards',
      /JSON/.test(wk) && /پاک/.test(wk));

    /*
     * A rotation done from a phone needs a way to see WHICH part is wrong.
     * `fcm: false` has three causes with three different fixes.
     */
    const fcmSrc = code(read('server/fcm.js'));
    t('the FCM diagnostic exists', /export function fcmDiagnose/.test(fcmSrc));
    t('...and separates the three private-key failure modes',
      /looksPem/.test(fcmSrc) && /hasNewlines/.test(fcmSrc) && /present:/.test(fcmSrc));
    /*
     * It must NEVER echo the key. The project id is fine - it already ships
     * in the browser bundle as VITE_FIREBASE_PROJECT_ID.
     */
    t('...and never echoes the private key itself',
      !/privateKey:\s*PRIVATE_KEY/.test(fcmSrc)
      && !/key:\s*PRIVATE_KEY\b/.test(fcmSrc));
    t('...and is reachable from the push status route',
      code(read('server/app.js')).includes('fcmDetail'));
  }

  /* ---- 85. Swap settings, and the three controls wired to nothing ------- */
  {
    const code = (src) => src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    const swapLib = code(read('src/lib/swap.js'));
    const swapPage = code(read('src/pages/Swap.jsx'));

    /*
     * ─── AUTO SLIPPAGE ──────────────────────────────────────────────────────
     * A single fixed tolerance is wrong in both directions, and the damage is
     * not the wrong default — it is that the 3% someone sets to push a thin
     * token through STAYS SET for their next stablecoin swap, where it is free
     * money for a sandwich bot. Deriving it per pair is what removes the
     * incentive to set a blanket-high value.
     */
    t('slippage can be derived from the pair', /export function suggestSlippage/.test(swapLib));
    /*
     * `Number(null)` is 0 and 0 is finite. If the null guard does not come
     * FIRST, a missing price impact reads as a perfect zero-impact trade and
     * returns the TIGHTEST tolerance for a pair we know nothing about — the
     * worst possible direction to be wrong in. Hit before in priceAlerts.
     */
    t('...and treats a missing impact as unknown, not as zero',
      /priceImpact == null/.test(swapLib));
    t('...and caps the suggestion rather than widening without limit',
      /Math\.min\(5,/.test(swapLib));
    /*
     * A reason, not just a number — a bare "1.2%" teaches nothing while
     * "1.2%, this pair is thin" tells the user why the next trade may differ.
     *
     * Matched as bare literals rather than `reason: 'thin'`: the thin/moderate
     * pair is returned from a ternary, so the key-colon form only ever matched
     * two of the four and the check passed for the wrong reason.
     */
    for (const r of ['stable', 'deep', 'moderate', 'thin', 'default']) {
      t(`...and can explain the '${r}' case`, new RegExp(`'${r}'`).test(swapLib));
    }
    /* Every reason must have copy, or the UI renders a raw key. */
    const enSwap = JSON.parse(read('src/i18n/locales/en.json')).swap;
    t('...and every reason has user-facing copy',
      ['stable', 'deep', 'moderate', 'thin', 'default']
        .every((r) => Boolean(enSwap.autoReason?.[r])));

    /*
     * The derived value must be what is QUOTED and SIGNED, not merely
     * displayed. Three copies kept in sync by hand is how a user consents to
     * one number and signs another.
     */
    t('the swap screen computes an effective slippage',
      /const effectiveSlippage/.test(swapPage));
    t('...and quotes with it', /slippage: effectiveSlippage/.test(swapPage));
    t('...and re-quotes with it before signing',
      (swapPage.match(/slippage: effectiveSlippage/g) || []).length >= 2);
    /*
     * The dependency array has to track the DERIVED value. Tracking the raw
     * one means auto-slippage changes never trigger a re-quote, so the screen
     * would show a stale price for the new tolerance.
     */
    t('...and re-quotes when the derived value changes',
      /effectiveSlippage, chainId/.test(swapPage));
    t('...and the review sheet shows what will actually be signed',
      /\{effectiveSlippage\}%/.test(swapPage));

    /*
     * ─── THE DEADLINE, UNREACHABLE UNTIL NOW ────────────────────────────────
     * `deadlineMinutes` has been a parameter of executeSwap since the file was
     * written, defaulting to 20, and no caller ever passed one. So every swap
     * this app has ever made used 20 minutes and the parameter was dead code.
     */
    t('the deadline is a real control', /setDeadlineMin/.test(swapPage));
    t('...and is actually forwarded to the signer',
      /deadlineMinutes: deadlineMin/.test(swapPage));

    /*
     * ─── "COMPARED N SOURCES", COMPUTED AND NEVER RENDERED ──────────────────
     * lib/swap.js returns `routesChecked` with a comment saying it "drives the
     * 'compared N routes' line in the UI". No such line existed — three
     * aggregators were quoted on every keystroke and the result thrown away.
     */
    t('the number of price sources reaches the screen',
      /quote\.routesChecked/.test(swapPage));
    /*
     * And when a route we cannot execute quoted better, say so. Hiding it is
     * the easy choice; a user who checks that venue later should have heard it
     * from us first.
     */
    t('...and a better quote-only route is disclosed, not hidden',
      /quote\.beatenBy/.test(swapPage));

    /*
     * ─── THE SWITCH, WHICH MUST NOT BE A CHECKBOX ───────────────────────────
     * `.switch` styles a BUTTON with `data-on` and an animated `.switch-knob`
     * child. An `<input type="checkbox" className="switch">` matches the
     * selector, inherits the track, and draws the browser's native tick inside
     * it with no knob — it LOOKS broken rather than failing loudly. Same shape
     * as the invented `className="seg"` that shipped here once.
     */
    t('the toggle is a shared component', existsSync('src/components/Switch.jsx'));
    t('...and is not reimplemented as a checkbox in the swap sheet',
      !/type="checkbox"[^>]*className="switch"/.test(swapPage));
    /* The RTL travel fix must survive the extraction. */
    t('...and keeps the RTL knob-travel correction',
      /rtl \? -19 : 19/.test(code(read('src/components/Switch.jsx'))));
    /* Settings must use the extracted one, not keep a private copy. */
    t('...and Settings uses it rather than a duplicate',
      !/function Switch\(/.test(code(read('src/pages/Settings.jsx'))));

    /*
     * Every class name used must be DEFINED. `set-row-title` was used in the
     * first draft of this sheet and exists in no stylesheet.
     */
    const cssText = read('src/index.css');
    for (const cls of ['set-row', 'set-row-label', 'set-row-sub', 'switch', 'switch-knob']) {
      t(`the ${cls} class is defined in CSS`,
        new RegExp(`\\.${cls}[^-a-zA-Z0-9]`).test(cssText));
    }
    t('...and the swap sheet uses no undefined set-row-title',
      !/set-row-title/.test(swapPage));
  }

  /* ---- 86. Buying with cash, and the warnings in one box ---------------- */
  {
    const code = (src) => src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    const p2p = code(read('src/pages/P2P.jsx'));

    /*
     * ─── THE INSTRUCTION THAT WAS MISSING ───────────────────────────────────
     * The fiat tab explained why we do not run a desk, listed three desks, and
     * listed four ways to be defrauded — and never once said HOW to complete a
     * purchase. All context and warning, no instruction, which is why it read
     * as discouraging rather than useful. The OTC tab had a numbered walk-
     * through; this side had none.
     */
    t('the cash tab explains how to actually buy', /p2p\.buyStep\./.test(p2p));
    const enP2p = JSON.parse(read('src/i18n/locales/en.json')).p2p;
    t('...in ordered steps', ['b1', 'b2', 'b3', 'b4', 'b5', 'b6']
      .every((k) => Boolean(enP2p.buyStep?.[k])));
    /*
     * The two instructions that actually prevent losses: pay from an account
     * in your own name, and never name crypto in the bank reference — banks
     * freeze accounts over that wording.
     */
    t('...and warns to pay from an account in your own name',
      /OWN NAME/i.test(JSON.stringify(enP2p.buyStep)));
    t('...and warns against naming crypto in the payment reference',
      /reference/i.test(JSON.stringify(enP2p.buyStep)));

    /*
     * ─── THE WARNINGS, COLLAPSED ────────────────────────────────────────────
     * Asked for directly. This tab rendered six separate warning surfaces:
     * four always-expanded red-numbered scam cards plus two notices. When
     * every block is a warning, none of them is — the exact mechanism InfoBox
     * was built for.
     */
    t('the scam warnings live in a collapsible box',
      /InfoBox title=\{t\('p2p\.scamsTitle'\)\}/.test(p2p));
    /* Nothing was deleted — all four keep their text. */
    t('...and all four scams are still present',
      /SCAMS\.map/.test(p2p) && ['reversal', 'thirdParty', 'offPlatform', 'overpay']
        .every((k) => Boolean(enP2p.scam?.[k]?.body)));
    /*
     * Physical cash has NO escrow and no arbitration — the most dangerous
     * case, and the screen said nothing about it. Silence does not stop
     * anybody; it just removes the two rules that matter.
     */
    t('...and in-person cash is addressed rather than ignored',
      /p2p\.cashTitle/.test(p2p));
    t('...stating that a physical handover has no escrow at all',
      /no escrow at all/i.test(String(enP2p.cashBody)));

    /* Persian must be hand-written, and present, in every new key. */
    const faP2p = JSON.parse(read('src/i18n/locales/fa.json')).p2p;
    t('the cash guide is translated into Persian',
      Boolean(faP2p.howTitle) && Boolean(faP2p.cashBody)
      && ['b1', 'b6'].every((k) => Boolean(faP2p.buyStep?.[k])));
  }

  /* ---- 87. Server features nobody can reach ----------------------------- */
  {
    /*
     * ─── THE BUG CLASS THIS REPO KEEPS SHIPPING ─────────────────────────────
     * Three times now a complete, tested, revenue-generating server feature
     * has gone live with no way for a user to arrive at it: the LI.FI bridge
     * shipped a release before the Bridge screen existed, priceAlerts had a
     * settings toggle read by nothing, and solanaRpc was stored and redrawn
     * but never used.
     *
     * Reviewing the whole app for "what could we add" turned up the largest
     * instance yet. `server/gasless.js` is 245 lines, has four live routes, a
     * working 0x key, and a measured 0.70% fee — verified against production
     * while writing this:
     *
     *   "integratorFee": { "amount": "70000" }   on a 10 USDC sell
     *
     * and the only place the word `gasless` appears in the entire UI is the
     * Developers page, which is an API listing no ordinary user opens. It
     * solves the single most common dead end in crypto — holding USDT with no
     * native coin for gas — and it is unreachable.
     *
     * This check does not fix it. It makes the class of bug VISIBLE, so a
     * feature cannot quietly become unreachable again, and it names the ones
     * currently outstanding rather than letting them be rediscovered by
     * accident in six months.
     */
    const uiFiles = [];
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(full);
        /* Developers.jsx is an API listing by design — referencing a route
           there is documentation, not reachability, so it must not count. */
        else if (/\.jsx?$/.test(entry.name) && entry.name !== 'Developers.jsx') {
          /*
           * COMMENTS STRIPPED FIRST. Caught by this very check on its first
           * run: lib/tapToPay.js DOCUMENTS `GET /api/gasless/price` in a
           * header comment explaining how tap-to-pay relates to it, and that
           * made the route look reachable when nothing calls it.
           *
           * That is the sixth time a check in this file has matched prose
           * instead of code. A route mentioned in a comment is documentation;
           * only a route in executable source is reachability.
           */
          uiFiles.push(
            read(full)
              .replace(/\/\*[\s\S]*?\*\//g, '')
              .replace(/^\s*\/\/.*$/gm, '')
          );
        }
      }
    };
    walk('src');
    const ui = uiFiles.join('\n');

    /*
     * A route counts as reachable when ANY non-Developers source mentions its
     * path prefix — directly, or through a lib wrapper that a screen imports.
     */
    const reachable = (prefix) => ui.includes(prefix);

    /* These are wired and must STAY wired. */
    for (const [name, prefix] of [
      ['the bridge', '/bridge/quote'],
      ['deBridge', '/dln/quote'],
      ['THORChain', '/thor/quote'],
      ['the Solana swap', '/solana/oo']
    ]) {
      t(`${name} is reachable from the UI`, reachable(prefix));
    }

    /*
     * ─── BOTH GAPS NOW CLOSED ───────────────────────────────────────────────
     * These two were recorded as "still unreachable" one commit ago, on the
     * reasoning that a test pinning a known gap fails the day somebody fixes
     * it — which is the prompt to update it. That is exactly what happened:
     * both flipped, and both assertions are now the positive ones.
     *
     * That is the mechanism working. A test asserting the current truth is
     * self-correcting; a test muted because "we know about that one" is not.
     */
    t('gasless is now reachable from the UI', reachable('/gasless/price'));
    t('...and so is the Tron route', reachable('/xchain/quotes'));

    /* Both must stay documented while they are unreachable. */
    const nx = existsSync('docs/NEXT-OPTIONS-FA.md') ? read('docs/NEXT-OPTIONS-FA.md') : '';
    t('the options review exists', nx.length > 0);
    t('...and names gasless as the top gap', /gasless/i.test(nx));
    t('...and names the Tron route', /xchain|ترون/i.test(nx));
    /*
     * The measured evidence has to travel with the claim, or the next reader
     * cannot tell a verified number from an optimistic one.
     */
    t('...and carries the measured fee proving gasless earns',
      /70000/.test(nx));
    /*
     * The Tron activation cost is near-FLAT, which is invisible as a
     * percentage until the amount is small — same shape as the deBridge fixed
     * fee. Losing that warning would ship a 17% loss looking like a fee.
     */
    t('...and warns about the near-flat Tron activation cost',
      /۸٫۲۹|17|۱۷/.test(nx));

    /* ---- the two features, now that they are wired ---------------------- */
    /* Redeclared: `code` is block-scoped per section in this file. */
    const code = (src) => src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    const swapPageSrc = code(read('src/pages/Swap.jsx'));
    const gl = code(read('src/lib/gasless.js'));
    const xc = code(read('src/lib/xchain.js'));

    /*
     * ─── GASLESS ────────────────────────────────────────────────────────────
     * The gas is paid out of the SOLD TOKEN. "No ETH needed" does not mean
     * free, and if that is not itemised before signing, the user does the
     * arithmetic afterwards and concludes we skimmed them. The honest version
     * of this feature has to show the cost it removes.
     */
    t('the gasless summary reports the gas taken from the token',
      /gasFee/.test(gl));
    /*
     * 0x return `integratorFees` (array) or `integratorFee` (object) depending
     * on the route. Reading only one reports OUR fee as zero on half of them.
     */
    t('...and reads both integrator-fee shapes',
      /integratorFees/.test(gl) && /integratorFee\?\./.test(gl));
    /*
     * Gasless has no native path by definition — if the user had native coin
     * they would not need it. Offering it for a native pair produces an
     * upstream error the user cannot act on.
     */
    t('...and refuses native tokens, which it cannot handle',
      /native/.test(gl));
    /*
     * EIP712Domain is implicit in ethers and MUST be deleted, or signing
     * throws on an ambiguous primary type. The single most common mistake
     * integrating 0x gasless.
     */
    t('...and strips EIP712Domain before signing',
      /delete t712\.EIP712Domain/.test(swapPageSrc));
    /*
     * A tradeHash is NOT a transaction hash — 0x have not submitted yet.
     * Linking it to an explorer shows a "not found" page at the most anxious
     * moment in the flow.
     */
    t('...and does not present the tradeHash as a transaction link',
      !/scan.*gaslessHash|gaslessHash.*href/.test(swapPageSrc));

    /*
     * ─── TRON ───────────────────────────────────────────────────────────────
     * The flat activation cost is invisible as a percentage until the amount
     * is small: $10 loses 17%, $1,000 loses 0.48%. Same shape as the deBridge
     * fixed fee, same treatment.
     */
    t('the Tron client warns on amounts the flat cost would eat',
      /tronAmountWarning/.test(xc));
    /*
     * `Number(null)` is 0 and 0 is finite. Folding the null check in would
     * report "this is fine" for an amount nobody has entered.
     */
    t('...and treats a missing amount as unknown, not as fine',
      /amountUsd == null/.test(xc));
    /* The loss figure is the server's, never re-derived on two sides. */
    t('...and passes the server loss figure through rather than recomputing',
      /lossPercent: res\.lossPercent/.test(xc));
    /*
     * Across a family boundary 0x default the destination to the ORIGIN
     * address — a Tron destination that is an EVM address nobody holds the key
     * to. A successful bridge straight into a burn.
     */
    t('...and validates the Tron address shape',
      /\^T\[1-9A-HJ-NP-Za-km-z\]\{33\}\$/.test(xc));
    t('...and the panel always sends an explicit destination',
      /destinationAddress: dest\.trim\(\)/.test(code(read('src/components/TronPanel.jsx'))));
    /* Reachable, or it is another 368 lines nobody can open. */
    t('...and the bridge screen offers a Tron tab',
      /'tron'\]/.test(code(read('src/pages/Bridge.jsx'))));

    /*
     * ─── NEW CHAINS, EACH PROVEN TO PAY BEFORE BEING LISTED ─────────────────
     * Asked why we list 7 networks when Trust Wallet lists ~100. A network is
     * only worth listing if it can SWAP and PAY US — a chain with no
     * aggregator route is a dropdown entry that answers "no route found" on
     * every pair, which is worse than absence. Trust Wallet can list 100
     * because it only has to show balances.
     *
     * Linea and Sonic were quoted live against KyberSwap with our real fee
     * receiver and both echoed feeAmount 70. Scroll was tried identically and
     * returned 404, so it is absent rather than listed and broken.
     */
    const chainsSrc = read('src/lib/chains.js');
    const aggSrc = read('src/lib/aggregator.js');
    for (const [name, id, slug] of [['Linea', '59144', 'linea'], ['Sonic', '146', 'sonic']]) {
      t(`${name} is a configured chain`, new RegExp(`^  ${id}: \\{`, 'm').test(chainsSrc));
      /* A chain in chains.js but not in the aggregator map quotes nothing. */
      t(`...and is routable through the aggregator`, aggSrc.includes(`'${slug}'`));
      /* And it needs tokens, or the picker opens empty. */
      t(`...and has a token list`, new RegExp(`^  ${id}: \\[`, 'm').test(chainsSrc));
    }
    t('Scroll stays out, since its aggregator route 404s',
      !/'scroll'/.test(aggSrc));

    /*
     * ─── NEW SECTORS, AND THE CHECK THAT ACTUALLY MATTERS ───────────────────
     * Asked for oil, AI and newer listings. A wrong mint address is the one
     * unrecoverable mistake this file can make — it sends money to a token
     * nobody can sell — so each was resolved live through Jupiter and matched
     * on the SAME mint and freeze authority as the assets already present. A
     * convincing fake can copy a name and a ticker; it cannot be minted by
     * Backed's authority.
     */
    const sol = read('src/lib/solanaAssets.js');
    for (const [sym, mint] of [
      ['XOMx', 'XsaHND8sHyfMfsWPj6kSdd5VwvCayZvjYgKmmcNL5qh'],
      ['CVXx', 'XsNNMt7WTNA2sV3jrb1NNfNgapxRF5i4i6GcnTRRHts'],
      ['PLTRx', 'XsoBhf2ufR8fTyNSjqfU71DYGaE6Z3SUGAidpzriAA4'],
      ['AVGOx', 'XsgSaSvNSqLTtFuyWPBhK9196Xb9Bbdyjj4fH3cPJGo'],
      ['AMZNx', 'Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg'],
      ['HOODx', 'XsvNBAYkrDRNhA7wPHQfX3ZUXZyZLdnCQDfHZ56bzpg']
    ]) {
      t(`${sym} is listed with its verified mint`,
        sol.includes(`symbol: '${sym}'`) && sol.includes(mint));
    }
    /* The authorities used to validate them must stay recorded. */
    t('...and the authority used to verify them is documented',
      sol.includes('7pt9tkctJPK7PPNQJ77GKg8ZffSF6QxoMiCFYHxrtaCj'));

    /*
     * ─── THE STOCKS WARNINGS, BOXED ─────────────────────────────────────────
     * Asked to put the warning at the top of the stocks page in a collapsible
     * box, and the bottom one too. Both done — but the top one keeps
     * `defaultOpen`, because the freeze authority is real and used, and
     * collapsing it closed would undo the reason it sits above everything.
     */
    const stk = code(read('src/pages/Stocks.jsx'));
    t('the freeze warning is a box', /id="stocks-freeze"/.test(stk));
    t('...and it is collapsible, per the owner\'s instruction',
      /id="stocks-freeze"/.test(stk) && !/stocks-freeze"[^>]*defaultOpen/.test(stk));
    t('the closing risk notice is a box too', /id="stocks-risk"/.test(stk));

    /*
     * ─── SHORTER COPY, WITHOUT LOSING A FACT ────────────────────────────────
     * Asked to shorten the long explanations across the app. The risk of
     * "shorten this" is deleting the sentence that was doing the work, so the
     * cap is paired with the existing content checks: shortening the hardware
     * caution below already broke `pre-generated-phrase attack` and had to be
     * rewritten to keep "marketplace".
     */
    for (const lang of ['en', 'fa']) {
      const L = JSON.parse(read(`src/i18n/locales/${lang}.json`));
      const longest = Math.max(
        ...[L.stocks?.freezeBody, L.farm?.whatBody, L.farm?.ilBody,
          L.dev?.fairUseBody, L.perp?.honestBody, L.hardware?.caution]
          .filter(Boolean).map((s) => s.length)
      );
      t(`${lang} trims the longest explainers under 430 chars`, longest < 430);
    }
  }

  /* ---- 88. Solana settings, MWA, calm music, and the decimals bug ------- */
  {
    const code = (src) => src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    /*
     * ─── "SWAP SETTINGS DO NOT WORK ON THE SOLANA TAB" ──────────────────────
     * They did not. The gear lives in Swap.jsx's SHARED header, above the tab
     * switcher, so it looked like it governed whichever tab was open — while
     * every control inside wrote to EVM-only state. SolanaSwap had no slippage
     * state at all and never sent one, so every Solana swap silently used
     * OpenOcean's server default whatever the user had chosen.
     *
     * `getOceanQuote`/`getOceanSwap` accepted `slippageBps` from the day they
     * were written. Neither call site supplied it.
     */
    const solPage = code(read('src/pages/SolanaSwap.jsx'));
    t('the Solana screen reads the stored slippage',
      /useSettingsStore\(\(s\) => s\.defaultSlippage\)/.test(solPage));
    t('...and sends it when pricing', (solPage.match(/slippageBps/g) || []).length >= 3);
    /*
     * The swap must use the SAME tolerance as the quote, or the user consented
     * to one number and signed another.
     */
    t('...and re-quotes when it changes',
      /address, slippageBps\]/.test(solPage));
    /*
     * 0 bps means "no tolerance at all" and fails every quote on a moving
     * market, so the conversion floors at 1.
     */
    t('...and never sends zero basis points',
      /Math\.max\(1, Math\.round\(pct \* 100\)\)/.test(code(read('src/pages/SolanaSwap.jsx'))));
    /* The sheet must show Solana-relevant controls, not EVM-only ones. */
    t('the settings sheet branches for the Solana tab',
      /chainTab === 'solana' \?/.test(code(read('src/pages/Swap.jsx'))));

    /*
     * ─── MOBILE WALLET ADAPTER ──────────────────────────────────────────────
     * Asked whether other Solana connection methods exist. One does now that
     * did not before: the official @solana-mobile/wallet-standard-mobile, which
     * gives Chrome for Android a real in-place connection where previously
     * there was none (extensions do not exist on mobile).
     */
    const sw = code(read('src/lib/solanaWallet.js'));
    t('Mobile Wallet Adapter can be registered', /registerMwa/.test(sw));
    /*
     * Solana Mobile's own platform table: iOS NOT supported, due to platform
     * restrictions on inter-app communication. Offering it there would be a
     * button that opens nothing.
     */
    t('...and is refused on iOS and desktop', /Android/i.test(sw) && /canUseMwa/.test(sw));
    /* A Capacitor WebView is not Chrome; the intent result never returns. */
    t('...and refused inside our own APK', /isNativeShell\(\)/.test(sw));
    /*
     * MWA registers as a WALLET STANDARD wallet — it never appears on
     * window.solana, so getSolanaProvider cannot see it.
     */
    t('...and is discovered through the current Wallet Standard app registry',
      /getWallets/.test(sw) && /walletStandardApi\?\.get/.test(sw));
    /*
     * Wallet Standard returns accounts as an array of objects whose `address`
     * is ALREADY a base58 string. Reusing the injected path's
     * `publicKey.toString()` would yield "[object Object]" as an address.
     */
    t('...and reads the address from the accounts array',
      /accounts\?\.\[0\]/.test(sw) && /address = account\?\.address/.test(sw));
    /* Disconnect must clear it or the UI shows a connected wallet forever. */
    t('...and disconnect clears the MWA session', /mwaAddress = null/.test(sw));
    /* Lazy import, or the package ships to every user who cannot use it. */
    t('...and the package is imported dynamically',
      /import\('@solana-mobile\/wallet-standard-mobile'\)/.test(sw));
    t('...and MWA can sign and send after connecting, not merely expose an address',
      /solana:signAndSendTransaction/.test(sw) && /mwaAccount/.test(sw));
    t('...and an empty wallet is refused before the signing prompt',
      /getSolanaSwapBalances/.test(solPage) && /INSUFFICIENT_BALANCE/.test(solPage));
    t('wallet-app launch links stay visible for Phantom, Solflare and Backpack',
      /backpackBrowseLink/.test(solPage) && /walletLinksTitle/.test(solPage));
    /* The button must not stay disabled once MWA is available. */
    t('...and the connect button accepts either path',
      /!hasWallet && !mwaReady/.test(solPage));

    /*
     * ─── THE CALM SECTION'S FIRST TRACK ─────────────────────────────────────
     * Reported broken. It was: `subject:ambient` matches anything TAGGED
     * ambient, and archive.org tags are author-supplied and cumulative. The
     * two items arriving at the top were tagged ambient AND, respectively,
     * `industrial/dark/drone` (Russian spoken word) and `harsh noise`
     * ("Humanhater"). Both legitimately ambient-tagged; neither remotely calm.
     */
    const calm = code(read('server/calm.js'));
    t('harsh genres are excluded from the calm search',
      /NOT subject:\(/.test(calm) && /harsh/.test(calm));
    /*
     * Re-checked on the RESULT too, because the query and the returned
     * metadata are not guaranteed to agree and `subject` can arrive as a bare
     * string rather than an array.
     */
    t('...and re-checked on each result', /calmSubjectOk\(d\.subject\)/.test(calm));
    /* Without requesting `subject` the re-check receives undefined and passes
       everything, which would make it decoration. */
    t('...with the subject field actually requested',
      /fl%5B%5D=subject/.test(calm));

    /*
     * ─── THE DECIMALS BUG THE TRON SCREEN EXPOSED ───────────────────────────
     * The loss percentage divided raw integers on the stated assumption that
     * "USDC and USDT are both 6-decimal". True everywhere we offered when it
     * was written; FALSE on BNB Chain, where both carry 18.
     *
     * Measured live: 100 USDC from BSC returned a correct quote and
     * `lossPercent: 100`. The bridge was fine; the arithmetic said the user
     * lost everything. A false 100% over a working route destroys trust in the
     * one warning on that screen that matters.
     */
    const xc = code(read('server/xchain.js'));
    t('the loss figure scales by each side decimals',
      /sellDecimals/.test(xc) && /buyDecimals/.test(xc));
    t('...and refuses to report an impossible loss',
      /pct >= 0 && pct < 100/.test(xc));
    t('...and the Tron panel sends the real token decimals',
      /sellDecimals: String\(token\.decimals\)/.test(code(read('src/components/TronPanel.jsx'))));
  }

  /* ---- 89. Perks, the rank medal, and the self-referential banner ------- */
  {
    const code = (src) => src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    /*
     * ─── THE BANNER THAT NAVIGATED TO ITSELF ────────────────────────────────
     * Reported: tapping the invite banner goes to another page. It did, and the
     * destination was the bug. `AdBanner slot="referral"` points at `/earn`,
     * and it was rendered ON the earn screen, directly under the referral card
     * it advertised. Inside the Rewards tabs it was worse: `/earn` is also a
     * standalone route, so the tap threw the user out of the tabbed screen into
     * a bare copy of the tab they were already reading.
     */
    const earn = code(read('src/pages/Earn.jsx'));
    t('the earn screen no longer advertises itself',
      !/AdBanner slot="referral"/.test(earn));
    t('...and neither does the leaderboard',
      !/AdBanner slot="referral"/.test(code(read('src/pages/Leaderboard.jsx'))));

    /*
     * ─── THE RANK MEDAL IN THE HEADER ───────────────────────────────────────
     * Asked for the medal between the brand and the settings cog. It shows the
     * medal ONLY — no number. Section 21 removed a virtual balance from that
     * exact spot because the first figure a user sees on a non-custodial
     * exchange must not look like money, and a points TOTAL beside the brand
     * would repeat that in a quieter way.
     */
    const header = code(read('src/components/Header.jsx'));
    t('the header shows a rank medal', /rank-chip/.test(header));
    t('...taking only the tier, never a points total',
      /usePoints\(\)/.test(header) && !/\{points\}/.test(header));
    /*
     * And it must still not reach the play-money store. The hook is the narrow
     * opening that keeps section 21's blunt rule intact.
     */
    t('...through a hook rather than the balance store',
      existsSync('src/hooks/usePoints.js') && !/useAppStore/.test(header));
    /* An invented class name fails silently — this has shipped here before. */
    const css = read('src/index.css');
    for (const cls of ['rank-chip', 'perk-row', 'perk-medal']) {
      t(`the ${cls} class is defined in CSS`,
        new RegExp(`\\.${cls}[^-a-zA-Z0-9]`).test(css));
    }

    /*
     * ─── PERKS: REAL DISCOUNTS, NEVER INVENTED VOUCHERS ─────────────────────
     * Asked whether ranks could unlock redeemable services that also earn
     * revenue. The dangerous version of this feature is a shop: spend points,
     * get a code, discover it buys nothing. Every gift-card route was checked
     * and fails for us — Bitrefill pays commission in STORE CREDIT, Travala
     * pays cash but only through Impact.com, which needs a bank account and a
     * tax form (already recorded as blocked under OFAC FAQ 54).
     *
     * So a perk is the venue's own referral discount on a venue we have
     * measured paying us. The checks below pin the two properties that keep it
     * honest.
     */
    const perks = code(read('src/lib/perks.js'));
    t('rank perks exist', existsSync('src/lib/perks.js'));
    /*
     * THE CRITICAL ONE. A perk whose venue code is not registered must never
     * produce a code or a link. Unit-tested at every rank including the top:
     * with nothing configured, nothing is claimable.
     */
    t('...and no code is issued unless the venue is really registered',
      /available: unlocked && configured/.test(perks));
    t('...and the link is null until then',
      /link: unlocked && configured/.test(perks));
    /*
     * Points are a SCORE, not a currency — lib/ranks.js says so explicitly.
     * Deducting them on redemption would make them a balance and would demote
     * the user for using the thing they earned.
     */
    t('...and points are never spent', !/spendPoints|deductPoints/.test(perks));
    /* Locked perks must still be visible, with the distance stated. */
    t('...and a locked perk states how far away it is',
      /pointsToGo/.test(perks) && /perks\.locked/.test(earn));
    /* The three states must stay distinct in the UI. */
    t('...and an unconfigured venue says so instead of handing out a link',
      /perks\.notReady/.test(earn));
    /* Every perk must route through the shared referral builder, or it earns
       nothing while looking identical. */
    t('...and every perk link carries the referral code',
      /withReferral\(p\.venue, p\.url\)/.test(perks));
    /* The disclosure is the reason the discount is believable. */
    t('...and the arrangement is disclosed to the user',
      /perks\.howTitle/.test(earn));

    const enPerks = JSON.parse(read('src/i18n/locales/en.json')).perks;
    const faPerks = JSON.parse(read('src/i18n/locales/fa.json')).perks;
    t('perks copy exists in English and Persian',
      Boolean(enPerks?.title) && Boolean(faPerks?.title) && Boolean(faPerks?.howBody));
    t('...and every perk has a title and description',
      ['gmxFee', 'avantisFee', 'utexStocks']
        .every((k) => Boolean(enPerks?.item?.[k]?.title) && Boolean(faPerks?.item?.[k]?.desc)));

    /*
     * ─── WHICH WALLETS ARE SOLANA WALLETS ───────────────────────────────────
     * Asked for an explainer in a collapsible box. The one fact that prevents
     * an unrecoverable mistake is that an 0x address is NOT a Solana address.
     */
    const solPage = code(read('src/pages/SolanaSwap.jsx'));
    t('the Solana wallet explainer is a collapsible box',
      /id="solana-which"/.test(solPage));
    const enSol = JSON.parse(read('src/i18n/locales/en.json')).solana;
    t('...naming the three Solana wallets',
      ['phantom', 'solflare', 'backpack'].every((w) => Boolean(enSol?.wallets?.[w]?.name)));
    t('...and how to connect on each platform',
      ['desktop', 'android', 'ios', 'app'].every((k) => Boolean(enSol?.how?.[k])));
    t('...and warns that an 0x address is not a Solana address',
      /0x/.test(String(enSol?.notSolana)));
    t('...translated into Persian',
      Boolean(JSON.parse(read('src/i18n/locales/fa.json')).solana?.notSolana));
  }

  /* ---- 90. Your points, and nobody else's ------------------------------- */
  {
    const code = (src) => src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    /*
     * ─── THE LEADERBOARD IS GONE, ON INSTRUCTION ────────────────────────────
     * Asked for directly: «تبدیلش کن به امتیاز تو و برترین ها نباشه [...] فقط
     * امتیاز همون فرد» — make it your points, no rankings, show only this
     * person's score.
     *
     * The trigger was the empty state reading "nobody has posted a score yet",
     * which is a strange thing for an app to say about itself. The deeper
     * problem: /api/leaderboard returned `{"rows":[]}` — measured live — so
     * ranking anyone produced "#1 of 1", which flatters and means nothing.
     */
    const board = code(read('src/pages/Leaderboard.jsx'));

    t('the screen no longer fetches a board', !/fetchLeaderboard/.test(board));
    t('...and no longer publishes the user\u2019s score', !/publishScore/.test(board));
    /*
     * Nothing on screen may rank, compare or name another user. Pinned as
     * separate literals because a single blanket regex passing tells you
     * nothing about WHICH half of the removal was done.
     */
    t('...no podium', !/Podium/.test(board));
    t('...no other users are listed', !/isUser/.test(board));
    t('...and no rank number is shown', !/rank\.yourRank|rank\.youArePlaced|rank\.leaderIs/.test(board));

    /*
     * THE POINT OF THE REPLACEMENT, not just the deletion. `pointsLog` has
     * been written on every award since points existed and was rendered
     * NOWHERE — grepped: zero .jsx references before this change. The user
     * could see a total but never where it came from, which is exactly what
     * makes a score feel arbitrary.
     */
    t('the points history is finally rendered', /pointsLog/.test(board));
    t('...newest first', /\.at \?\? 0\) - \(a\.at \?\? 0\)|b\.at - a\.at/.test(board));
    t('...with the date of each award', /fmtDateTime/.test(board));

    /*
     * Quest awards are logged as `quest:<id>`, which is not a translation key.
     * Without stripping the prefix the row renders the literal string
     * "quest:firstSwap" — the same raw-key leak this suite exists to catch.
     */
    t('quest awards resolve to a human label, not a raw id',
      /replace\(\/\^quest:\//.test(board));
    /* i18next returns the key when it is missing, so a fallback is required. */
    t('...and an unknown action never renders as its key',
      /defaultValue: ''/.test(board));

    /*
     * ─── THE PRIVACY CLAIM MUST BE STRUCTURALLY TRUE ────────────────────────
     * The screen tells the user in three languages that their score is not
     * published. A sentence is not a guarantee: the client module and both
     * server routes are DELETED, so there is no code path left that could
     * upload a name and a score.
     */
    t('the leaderboard client module is deleted', !existsSync('src/lib/leaderboard.js'));
    const server = read('server/app.js');
    t('...the public write route is gone', !/app\.post\('\/api\/leaderboard'/.test(server));
    t('...and the public read route with it', !/app\.get\('\/api\/leaderboard'/.test(server));
    /*
     * Deleted from the store too. An exported writer that takes a name and a
     * score, still wired to durable storage, is one import away from silently
     * resurrecting the collection we just promised not to do — the same reason
     * the fifty invented names were deleted rather than left unused.
     */
    const store = read('server/store.js');
    t('...and the store no longer keeps a scores bucket',
      !/export async function submitScore/.test(store) && !/leaderboard:v1/.test(store));

    /* Every locale says it, hand-written, not machine-translated. */
    for (const lang of ['en', 'fa', 'ar']) {
      const R = JSON.parse(read(`src/i18n/locales/${lang}.json`)).rank;
      t(`${lang} states the score is private`, String(R?.privateNote ?? '').length > 60);
      /* First person: "you haven't earned any yet", not "nobody has". */
      t(`${lang} has a first-person empty state`, String(R?.noneYet ?? '').length > 40);
      t(`${lang} labels the history section`, Boolean(R?.historyTitle));
      /* Board-era keys must not linger: an unused key gets re-used by mistake. */
      for (const dead of ['emptyBoard', 'leaderIs', 'youArePlaced', 'pendingSync', 'yourRank', 'top', 'refs']) {
        t(`${lang} drops the board-era key ${dead}`, R?.[dead] === undefined);
      }
    }

    /*
     * The signposts must agree with the destination. A tab labelled "Ranking"
     * that opens a screen with no ranking is the dead-signpost failure this
     * suite audits for everywhere else.
     */
    for (const lang of ['en', 'fa', 'ar']) {
      const L = JSON.parse(read(`src/i18n/locales/${lang}.json`));
      t(`${lang} does not label the tab a ranking`,
        !/ranking|رتبه|ترتيب/i.test(String(L.nav?.leaderboard ?? '')));
      t(`${lang} does not send the reader to a board that is gone`,
        !/leaderboard|جدول|لوحة/i.test(String(L.rank?.viewBoard ?? '')));
    }

    /*
     * ─── COPY THE OWNER ASKED TO CHANGE ─────────────────────────────────────
     * The "we will not hand you a code that does nothing" line was defensive
     * and pointed at a failure the user has not had. Removed in every locale.
     */
    for (const lang of ['en', 'fa', 'ar']) {
      const L = JSON.parse(read(`src/i18n/locales/${lang}.json`));
      t(`${lang} drops the defensive not-ready sentence`,
        String(L.perks?.notReady ?? '').length < 60);
    }
    /* The "why is this free" answer must still explain WHO pays. */
    t('the perk explainer still names who funds the discount',
      /venue pays us/i.test(String(
        JSON.parse(read('src/i18n/locales/en.json')).perks?.howBody
      )));

    /*
     * ─── PREFER OUR OWN SCREENS FOR REAL YIELD ──────────────────────────────
     * Asked for. `liquidStake` pointed at lido.fi, which was a genuine
     * mistake: the Farm screen already sells stETH and rETH, and for a liquid
     * staking token BUYING IT IS THE DEPOSIT. The user was sent elsewhere for
     * something this app does in one swap, and we earned nothing for it.
     */
    const earnSrc = code(read('src/pages/Earn.jsx'));
    t('liquid staking routes to our own farm screen',
      /id: 'liquidStake'[\s\S]{0,220}internal: '\/farm'/.test(earnSrc));
    /*
     * And the user must be able to TELL. The chevron already encoded it, but
     * only for somebody who knows the convention.
     */
    t('...and in-app routes are labelled as such', /earn\.inApp/.test(earnSrc));
    t('...in Persian too',
      Boolean(JSON.parse(read('src/i18n/locales/fa.json')).earn?.inApp));
  }

  /* ---- 91. Points that are really earned, perks that must be reached ---- */
  {
    const code = (src) => src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    /*
     * ─── REAL BUG: FIVE OF SIX QUESTS COULD NEVER BE COMPLETED ──────────────
     * Asked to make sure points are genuinely earned. They were not. The Earn
     * screen advertised six quests; only `inviteFriend` ever called
     * awardPoints. The other five just navigated to a screen and left the row
     * un-ticked forever, so the app promised 685 points nobody could collect.
     *
     * Worse, `completeQuest` paid the WRONG CURRENCY — it credited `balance`
     * (the arcade's play-money NX) and XP, neither of which is the reputation
     * score the tiers and the leaderboard read. A quest could "complete" and
     * move the rank not at all.
     */
    const store = code(read('src/store/useAppStore.js'));
    t('completing a quest awards reputation points',
      /awardPointsOnce\(`quest:\$\{questId\}`/.test(store));
    /*
     * The reward table must be POINT_VALUES — the same source the UI prints on
     * each row. Duplicating the numbers is how a row advertises 300 and pays
     * 150.
     */
    t('...from the same table the screen displays',
      /QUEST_POINTS/.test(store) && /POINT_VALUES\.firstSwap/.test(store));

    /* Each quest must fire from the real event, not from tapping the row. */
    const swapSrc = code(read('src/pages/Swap.jsx'));
    t('the swap quest fires on a confirmed receipt',
      /if \(ok\) \{[\s\S]*?rewards\.completeQuest\('firstSwap'\)/.test(swapSrc));
    t('the wallet quest covers every connect path',
      /completeQuest\('connectWallet'\)/.test(code(read('src/context/WalletContext.jsx'))));
    t('the 2FA quest fires after the code is verified',
      /completeQuest\('enable2fa'\)/.test(code(read('src/pages/Settings.jsx'))));
    t('the backup quest fires after a successful export',
      /completeQuest\('backupWallet'\)/.test(code(read('src/pages/Wallet.jsx'))));

    /*
     * `addLiquidity` was REMOVED rather than wired. The Farm screen links out
     * to PancakeSwap and Venus, so the deposit happens on somebody else's site
     * and we cannot see it. Paying on the tap would reward a click any user
     * could farm; leaving it advertised and unearnable is the bug being fixed.
     */
    const earnSrc = code(read('src/pages/Earn.jsx'));
    t('the unverifiable liquidity quest is gone, not left dangling',
      !/id: 'addLiquidity'/.test(earnSrc));

    /*
     * ─── PERKS START AT GOLD ────────────────────────────────────────────────
     * Asked for: nothing for Bronze or Silver, so there is a reason to climb.
     * Bronze is 0 points — every user is Bronze on install, and a reward that
     * arrives before any effort is the default state rather than a prize.
     */
    const perks = code(read('src/lib/perks.js'));
    t('no perk is granted below gold',
      !/tier: 'bronze'/.test(perks) && !/tier: 'silver'/.test(perks));
    /* And the higher tiers now have their own, so the ladder keeps going. */
    for (const tierId of ['gold', 'platinum', 'diamond']) {
      t(`...and ${tierId} has a perk of its own`,
        new RegExp(`tier: '${tierId}'`).test(perks));
    }
    /*
     * Locked perks must still be VISIBLE with their distance. A reward nobody
     * can see motivates nobody; one you can see and cannot reach yet is the
     * entire mechanism being asked for.
     */
    t('...and locked perks still show how far away they are',
      /pointsToGo/.test(perks) && /perks\.locked/.test(earnSrc));

    /*
     * ─── THE WARNINGS ───────────────────────────────────────────────────────
     * Asked to write them better. The points notice has to say the one thing
     * that could mislead — they never become money — and the yield warning has
     * to name what actually costs people money rather than listing hazards.
     */
    for (const lang of ['en', 'fa']) {
      const L = JSON.parse(read(`src/i18n/locales/${lang}.json`));
      t(`${lang} warns that yield is paid by someone taking a risk`,
        String(L.earn?.realRisk ?? '').length > 150);
      /* The actionable half matters more than the hazard list. */
      t(`${lang} tells the reader what to actually do about it`,
        /read|بخوان/i.test(String(L.earn?.realRisk ?? '')));
    }

    /*
     * ─── THE POINTS NOTICE IS GONE, ON REQUEST ──────────────────────────────
     * Two guards here used to require `earn.pointsNotice` to exist and to
     * mention Gold. The owner asked for that red slab at the foot of the
     * quests list to be deleted, and it WAS redundant: FbtPanel now states the
     * same limits once, in one line, directly under the balance they describe.
     *
     * The claim is not lost, and this asserts that in both directions — the
     * old copy must be gone AND the replacement must still be present, so
     * "delete the warning" can never quietly become "ship with no warning".
     */
    for (const lang of ['en', 'fa', 'ar']) {
      const L = JSON.parse(read(`src/i18n/locales/${lang}.json`));
      t(`${lang} dropped the old points notice`, L.earn?.pointsNotice === undefined);
      t(`${lang} still states the limit once, on the balance itself`,
        String(L.fbt?.notCoin ?? '').length > 80);
    }
    t('...and nothing renders the removed key', !/pointsNotice/.test(read('src/pages/Earn.jsx')));
  }

  /* ---- 92. the white box behind the logo, on both platforms -------------- */
  /*
   * REPORTED: «لوگو در pwa با یک کادر سفید هست جالب نیست» — a white box around
   * the logo. There were THREE separate causes, all real and all measured.
   *
   * ─── CAUSE 1 · no maskable icon at 192, which is the size a phone uses ───
   * The manifest declared maskable at 512 ONLY. Chrome picks the icon nearest
   * the launcher's requested size — 192 on almost every phone — and at 192 the
   * only candidates were purpose "any". Android Oreo and later force one
   * silhouette on every home-screen icon, and an icon it cannot mask is
   * SHRUNK AND PLACED ON A WHITE PLATE. That white plate is the report.
   *
   * The 512 maskable entry looked like the box was ticked, which is why this
   * survived: the Lighthouse audit "has a maskable icon" passed, because it
   * only checks that SOME entry declares the purpose.
   *
   * ─── CAUSE 2 · the native app's splash was a white Capacitor placeholder ──
   * Every splash.png in android/ was measured at 98.8% pure #FFFFFF carrying
   * the stock blue Capacitor "X" — not our mark, never replaced since
   * `cap add android`. Cold start was: white screen, stranger's logo, then a
   * black app.
   *
   * ─── CAUSE 3 · Android 12+ ignored all of it ─────────────────────────────
   * From API 31 the system draws its own splash and does not read
   * android:windowBackground when it is a drawable. With no
   * windowSplashScreenBackground set it derives the colour from the theme —
   * and the theme's parent was Theme.AppCompat.LIGHT.DarkActionBar. A Light
   * parent under an all-black app is a white window background, so the flash
   * came back on exactly the devices most people own.
   */
  {
    const m = JSON.parse(read('public/manifest.webmanifest'));
    const icons = m.icons ?? [];
    const maskable = icons.filter((i) => String(i.purpose ?? '') === 'maskable');
    const anyPurpose = icons.filter((i) => String(i.purpose ?? 'any') === 'any');

    /*
     * 192 is the operative one — that is what the launcher asks for. Pinning
     * the literal size rather than "has some maskable icon" is the whole point
     * of this section; the generic form is what passed while broken.
     */
    t('there is a maskable icon at 192, the size a phone actually requests',
      maskable.some((i) => i.sizes === '192x192'));
    t('...and at 512, for the install prompt and splash',
      maskable.some((i) => i.sizes === '512x512'));

    /*
     * "any maskable" on one file is the trap web.dev warns about: the padded
     * artwork gets used UNMASKED too, and then the logo looks too small next
     * to every other app. Separate files, separate purposes.
     */
    t('no icon claims both purposes at once',
      icons.every((i) => !/\s/.test(String(i.purpose ?? '').trim())));
    t('the unmasked icons are still full-bleed',
      anyPurpose.some((i) => i.sizes === '192x192') && anyPurpose.some((i) => i.sizes === '512x512'));

    /* Every file named must exist, including the new ones. */
    const missing = icons
      .map((i) => i.src.replace(/^\//, ''))
      .filter((p) => !existsSync(join('public', p)));
    t(`every icon file exists${missing.length ? ` — missing: ${missing.join(', ')}` : ''}`,
      missing.length === 0);

    /*
     * Shortcuts get masked by the same launcher. They pointed at the
     * full-bleed icon-192, so a long-press menu showed three more white boxes.
     */
    t('the shortcut icons are maskable too',
      (m.shortcuts ?? []).every((s) =>
        (s.icons ?? []).some((i) => String(i.purpose ?? '') === 'maskable')));

    /*
     * A maskable icon MUST be opaque to the corners. A transparent one is
     * filled by the OS with its own grey or white before masking — the same
     * white box by another route. Checked by reading the PNG header: colour
     * type 2 is RGB with no alpha channel at all, which cannot be transparent.
     * (Types 6 and 4 carry alpha and would need a pixel scan we do not do
     * here, so they are rejected outright rather than assumed safe.)
     */
    for (const i of maskable) {
      const buf = readFileSync(join('public', i.src.replace(/^\//, '')));
      const colourType = buf[25];
      t(`${i.src} is opaque (PNG colour type ${colourType}, no alpha)`,
        colourType === 2 || colourType === 0);
    }
  }

  /* ---- 92b. the native launch screen ------------------------------------ */
  {
    const RES = 'android/app/src/main/res';

    /*
     * The stock white bitmaps are GONE, not merely overwritten. Leaving eleven
     * fixed-aspect PNGs in place means the next `cap sync` or a stray density
     * bucket can put one back on screen, and a stretched 480x320 on a 20:9
     * phone is its own defect.
     */
    const strays = readdirSync(RES)
      .filter((d) => /^drawable-(land|port)-/.test(d));
    t(`the fixed-aspect splash buckets are gone${strays.length ? ` — found ${strays.join(', ')}` : ''}`,
      strays.length === 0);
    t('the old placeholder bitmap is gone', !existsSync(join(RES, 'drawable/splash.png')));

    /* Replaced by a layer-list: a flat brand colour plus a centred mark, so
       nothing is ever stretched and one file covers every screen. */
    const splash = read(join(RES, 'drawable/splash.xml'));
    t('the launch background is a layer-list, not a stretched bitmap',
      /<layer-list/.test(splash));
    t('...it paints the brand colour to the edges',
      /@color\/ic_launcher_background/.test(splash));
    t('...and centres the mark instead of scaling it',
      /android:gravity="center"/.test(splash) && /@drawable\/splash_mark/.test(splash));

    /* The mark must exist at every density, or the launcher upscales one. */
    for (const d of ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']) {
      t(`the splash mark ships at ${d}`, existsSync(join(RES, `drawable-${d}/splash_mark.png`)));
    }

    const styles = read(join(RES, 'values/styles.xml'));

    /*
     * THE ANDROID 12 ATTRIBUTES. Without these the OS builds its own splash
     * from the theme and ignores the drawable entirely.
     */
    t('Android 12+ is told which colour to use for the splash',
      /windowSplashScreenBackground[^>]*>@color\/ic_launcher_background/.test(styles));
    t('Android 12+ is told which icon to draw',
      /windowSplashScreenAnimatedIcon[^>]*>@drawable\/splash_icon/.test(styles));
    t('the splash icon file exists', existsSync(join(RES, 'drawable/splash_icon.png')));
    /* And it must hand over to the running theme, or the launch drawable
       stays behind the WebView for the life of the process. */
    t('the launch theme hands over to the app theme afterwards',
      /postSplashScreenTheme[^>]*>@style\/AppTheme\.NoActionBar</.test(styles));

    /*
     * No Light parent anywhere. This is the root cause of cause 3 and it is a
     * single word in a parent attribute — exactly the kind of thing that gets
     * reintroduced by a template.
     */
    t('no theme inherits from a Light parent',
      !/parent="Theme\.AppCompat\.Light/.test(styles));
    /* The window background must be an explicit brand colour rather than
       @null, which lets whatever is underneath (white) show through. */
    t('the running theme paints its own background, not @null',
      !/android:background">@null</.test(styles));

    /*
     * One black, four places. When the launcher icon background, the splash,
     * the theme and Capacitor disagree the launch reads as a hand-off between
     * different apps.
     */
    const colours = read(join(RES, 'values/ic_launcher_background.xml'));
    const brand = (colours.match(/name="ic_launcher_background">(#[0-9A-Fa-f]{6})/) ?? [])[1];
    t(`the brand black is declared once (${brand})`, brand === '#00030F');
    const cap = JSON.parse(read('capacitor.config.json'));
    t('...and Capacitor agrees with it',
      String(cap.android?.backgroundColor ?? '').toLowerCase() === brand.toLowerCase());
    t('...and so does the splash plugin',
      String(cap.plugins?.SplashScreen?.backgroundColor ?? '').toLowerCase() === brand.toLowerCase());

    /* colorAccent resolved to Capacitor's stock Material indigo #3F51B5,
       which is not a colour that appears anywhere in this product. */
    t('the accent is ours, not the Capacitor default',
      /name="brand_accent"/.test(colours) && /colorAccent">@color\/brand_accent/.test(styles));
  }

  /* ---- 93. one home for the verdict, history on gold, a real address ----- */
  {
    const code = (src) => src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    /*
     * ─── "WHAT THE PAST SAYS" ON THE STOCKS SCREEN ──────────────────────────
     * Asked for: «در صفحه سهام گذشته چه میگوید را بزار باشد».
     *
     * It is attached to GOLD, and that is a data constraint rather than a
     * choice. The equity rows come from /api/solana/assets, which returns a
     * Jupiter spot price and a 24h change — one number and a delta, no series.
     * HistoryPanel measures support levels, range position and the largest
     * drawdown ACROSS A WINDOW, so with no window it computes nothing and
     * renders empty. PAXG is on CoinGecko, so a real 90-day series exists.
     */
    const stocks = code(read('src/pages/Stocks.jsx'));
    t('the stocks screen renders the history panel', /<HistoryPanel/.test(stocks));
    t('...fed by a real gold series, not the spot-only equity rows',
      /useChart\(goldId, 90\)/.test(stocks) && /'pax-gold'/.test(stocks));
    /*
     * historyFacts() returns [] below 20 points, which would render an empty
     * section header with nothing under it. Gate on the data, not on hope.
     */
    t('...and is hidden when there is not enough history',
      /goldSeries\.length >= 20/.test(stocks));
    /*
     * The id must be null unless the section is really shown — useChart polls
     * every 60s, so an unconditional fetch would hit CoinGecko forever on the
     * RWA tab and while the asset list is still loading.
     */
    t('...and nothing is fetched while the gold section is not on screen',
      /commodities\.length > 0 && tab === 'equity' \? 'pax-gold' : null/.test(stocks));

    /*
     * ─── A SUPPORT ADDRESS ON OUR OWN DOMAIN ────────────────────────────────
     * Asked whether info@fbtswap.ir is possible. The code path already
     * existed — SUPPORT_EMAIL reads VITE_SUPPORT_EMAIL and withContactEmail()
     * rewrites the address inside already-translated sentences — but the
     * variable was documented NOWHERE, so the capability was unreachable in
     * practice. A switch nobody can find is the same as no switch.
     */
    t('the support address is configurable', /VITE_SUPPORT_EMAIL/.test(read('src/lib/contact.js')));
    t('...and the variable is documented for whoever sets it',
      /VITE_SUPPORT_EMAIL/.test(read('.env.example')));
    /*
     * ─── THE ONE STEP THAT CANNOT BE AUTOMATED FROM HERE ────────────────────
     * The APK is built by CI, and Vite inlines import.meta.env at BUILD TIME.
     * So `.github/workflows/build-apk.yml` must also pass the variable through
     * with `VITE_SUPPORT_EMAIL: ${{ vars.VITE_SUPPORT_EMAIL }}`, or setting it
     * in Vercel changes the website and leaves the Android app on the old
     * Gmail address — the two disagree while both look correct in isolation.
     * The same trap is already documented for VITE_FEE_BPS in that file.
     *
     * This is NOT asserted, deliberately. GitHub refuses a push from this
     * agent's token that touches `.github/workflows/` ("refusing to allow a
     * GitHub App to create or update workflow ... without `workflows`
     * permission"), so the line has to be added by the owner by hand. A check
     * that can never pass would be a permanently red build that trains people
     * to ignore the suite.
     *
     * The step is written down in docs/EMAIL-DOMAIN-FA.md instead, and this
     * check makes sure it stays written down.
     */
    t('the CI step that cannot be automated is documented',
      /VITE_SUPPORT_EMAIL/.test(read('docs/EMAIL-DOMAIN-FA.md')));
    /*
     * The rewrite must stay wired into i18n. Without it, changing the variable
     * updates the Contact screen but not the twelve locale bundles that embed
     * the address mid-sentence — a support address that is stale in one screen
     * is worse than a missing one, because the user writes into a void.
     */
    t('translated copy is rewritten too, not just the Contact screen',
      /withContactEmail/.test(read('src/i18n/index.js')));
    /* The needle must not follow the setting, or the search finds nothing. */
    const contact = code(read('src/lib/contact.js'));
    t('the legacy address is a fixed needle, not a second setting',
      /LEGACY_EMAIL_IN_LOCALES = 'fbtswap@gmail\.com'/.test(contact));
  }

  /* ---- 94. the package rename, and the four things it silently breaks ---- */
  /*
   * Bazaar rejected the upload: «نام بسته قبلی را میگه تکراری» — the package
   * name is already taken. It is `ir.fbt.swap` under a Cafe Bazaar account
   * that is not reachable, and a package name is PERMANENT once published, so
   * the only route to a Bazaar/Myket listing is a new one.
   *
   * A package rename is not a find-and-replace. It is the app's identity to
   * the OS, and four separate things key off it. Each is asserted here because
   * three of the four fail SILENTLY — the build stays green and the damage
   * only shows up on a user's phone.
   */
  {
    const APP_ID = 'ir.fbtswap.app';

    /* 1. The three places Android itself reads. */
    const gradle = read('android/app/build.gradle');
    t(`build.gradle declares the new applicationId (${APP_ID})`,
      new RegExp(`applicationId "${APP_ID}"`).test(gradle));
    t('...and the matching namespace',
      new RegExp(`namespace "${APP_ID}"`).test(gradle));
    const cap = JSON.parse(read('capacitor.config.json'));
    t('Capacitor agrees', cap.appId === APP_ID);

    /*
     * 2. The Java package must match the directory it lives in, or javac
     *    refuses to compile. This one at least fails loudly.
     */
    t('MainActivity moved to the matching directory',
      existsSync('android/app/src/main/java/ir/fbtswap/app/MainActivity.java'));
    t('...and its package statement was updated',
      new RegExp(`package ${APP_ID.replace(/\./g, '\\.')};`)
        .test(read('android/app/src/main/java/ir/fbtswap/app/MainActivity.java')));
    t('...and the old directory is gone, not left as a stale copy',
      !existsSync('android/app/src/main/java/ir/fbt/swap/MainActivity.java'));

    /*
     * 3. SILENT FAILURE #1 — WalletConnect's return link.
     *    `redirect.native` is the custom scheme a wallet uses to hand control
     *    back after signing. The scheme is derived from the package name, so
     *    a rename that misses it leaves the user stranded INSIDE their wallet
     *    app after approving: the approval genuinely succeeded, but nothing
     *    comes back. Reported once already; that is why the guard exists.
     */
    const strings = read('android/app/src/main/res/values/strings.xml');
    const scheme = /<string name="custom_url_scheme">([^<]+)</.exec(strings)?.[1];
    t(`the deep-link scheme was renamed too (${scheme})`, scheme === APP_ID);
    t('...and WalletConnect points at the new one',
      read('src/context/WalletContext.jsx').includes(`${APP_ID}://`));
    t('...with the manifest declaring it',
      /android:scheme="@string\/custom_url_scheme"/.test(
        read('android/app/src/main/AndroidManifest.xml')));

    /*
     * 4. SILENT FAILURE #2 — the wallet backup path.
     *    Android's per-app external directory is Android/data/<packageName>/.
     *    A stale hint sends someone hunting for their encrypted seed backup in
     *    a folder that does not exist, at the worst possible moment.
     */
    t('the backup folder hint follows the package name',
      read('src/lib/walletBackup.js').includes(`Android/data/${APP_ID}/files`));

    /*
     * 5. FIREBASE — now genuinely re-registered, not hand-patched.
     *
     *    The google-services plugin matches `package_name` against the
     *    applicationId and fails the build on a mismatch. That check alone is
     *    NOT enough, and this guard used to be fooled by exactly that: for one
     *    release the file was a hand-edited copy where the package string had
     *    been swapped but `mobilesdk_app_id` still belonged to the app
     *    registered under the OLD name. The build passed, and FCM routes by
     *    App ID — so push would have kept working and then stopped without
     *    warning, which is the worst shape a bug can take.
     *
     *    The owner has since registered ir.fbtswap.app properly in the
     *    Firebase console, and the real file carries TWO clients with two
     *    DISTINCT App IDs. So the check is now: our package must be present
     *    AND must own an App ID that no other package shares.
     */
    const gs = JSON.parse(read('android/app/google-services.json'));
    const clients = gs.client.map((c) => ({
      pkg: c.client_info.android_client_info.package_name,
      appId: c.client_info.mobilesdk_app_id
    }));
    const mine = clients.find((c) => c.pkg === APP_ID);
    t(`google-services.json registers ${APP_ID}`, Boolean(mine));
    /*
     * The distinctness test is the one that would have caught the hand-edit.
     * A copied App ID means the file was edited rather than downloaded.
     */
    t('...with an App ID of its own, not one copied from the old package',
      Boolean(mine) && clients.every((c) => c.pkg === APP_ID || c.appId !== mine.appId));
    /*
     * The old package stays listed on purpose: users on the previous build are
     * still subscribed under it, and removing it would silently cut their
     * alerts off.
     */
    t('...and the old package is kept so existing users keep their alerts',
      clients.some((c) => c.pkg === 'ir.fbt.swap'));
    /* Every client must belong to the project the server actually pushes from. */
    t('...inside the project the server sends from (fbt-room-a46fc)',
      gs.project_info.project_id === 'fbt-room-a46fc');
    t('...and the re-registration step is written down, not assumed',
      /google-services\.json/.test(read('docs/PACKAGE-RENAME-FA.md')));

    /*
     * 6. NOTHING may still reference the old id in shipped code. Docs and the
     *    changelog legitimately mention it as history, so only source and
     *    Android config are scanned.
     */
    /*
     * google-services.json is deliberately EXCLUDED: it legitimately still
     * lists ir.fbt.swap as a second Firebase client so users on the previous
     * build keep receiving alerts. That case is checked properly just above,
     * by App ID. Everything else must be clean.
     */
    const shipped = [
      'capacitor.config.json',
      'android/app/build.gradle',
      'android/app/src/main/res/values/strings.xml',
      'android/app/src/main/AndroidManifest.xml',
      'src/lib/walletBackup.js',
      'src/context/WalletContext.jsx'
    ];
    const stale = shipped.filter((f) => existsSync(f) && read(f).includes('ir.fbt.swap'));
    t(`no shipped file still says ir.fbt.swap${stale.length ? ` — ${stale.join(', ')}` : ''}`,
      stale.length === 0);

    /*
     * 7. A rename makes the app a DIFFERENT app to Android: it installs
     *    alongside the old one instead of updating it, and the old install
     *    keeps its data. Anyone with an in-app wallet must export their seed
     *    BEFORE uninstalling the old build. That warning has to exist.
     */
    const doc = read('docs/PACKAGE-RENAME-FA.md');
    t('the "it installs alongside, it does not update" warning is documented',
      /کنار|جداگانه/.test(doc));
    t('...and the seed-backup-before-uninstall warning with it',
      /عبارت بازیابی|پشتیبان/.test(doc));
  }

  /* ---- 95. the classifieds board: a forum, never a money transmitter ----- */
  {
    const code = (src) => src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    /*
     * ─── THE LINE THIS FEATURE IS BUILT ON ──────────────────────────────────
     * FinCEN: a platform that "only provides a forum where buyers and sellers
     * post their bids and offers" while "the parties themselves settle through
     * an outside venue" is NOT a money transmitter. Escrow, dispute handling,
     * or a fee ON THE TRANSFER crosses it — a felony under 18 USC 1960 when
     * unlicensed.
     *
     * Asserted as ABSENCES, because the danger is a well-meaning future commit
     * adding "just a small escrow" and nothing failing.
     */
    const server = code(read('server/board.js'));
    const client = code(read('src/lib/board.js'));
    const panel = code(read('src/components/BoardPanel.jsx'));

    for (const [name, src] of [['server', server], ['client', client], ['UI', panel]]) {
      t(`the board ${name} holds no escrow`, !/escrow/i.test(src));
      t(`...and arbitrates no disputes (${name})`, !/dispute|arbitrat/i.test(src));
    }
    /* No endpoint may exist that settles or releases a trade. */
    t('there is no settle/release/refund route',
      !/\/board\/(settle|release|refund|trade|escrow)/.test(code(read('server/app.js'))));

    /*
     * ─── THE OPS BUDGET, WHICH IS WHAT KEEPS THIS FREE ──────────────────────
     * Vercel Blob's free tier is 10,000 SIMPLE OPS PER MONTH. One blob per
     * listing would spend that in days: a single feed load costs one op per
     * row, so 200 users refreshing a 50-row board is 10,000 ops in an
     * afternoon. The whole board is therefore ONE document, served from the
     * in-process cache in store.js on a warm instance for zero ops.
     */
    t('the whole board lives under one storage key', /const KEY = 'board:v1'/.test(server));
    t('...with a hard row cap so a cold read stays small', /MAX_ROWS/.test(server));
    t('...and listings expire on their own, with no cron to depend on',
      /TTL_MS/.test(server) && /isLive/.test(server));

    /*
     * ─── PAY TO PUBLISH: AN UNPAID ADVERT MUST BE INVISIBLE ─────────────────
     * A free board fills with adverts from people with nothing to sell.
     * Charging for the slot costs a spammer real money per advert.
     *
     * The property that matters is that invisibility is enforced by the DATA,
     * not by a caller remembering to filter: `liveUntil` is set ONLY by
     * activateListing, which runs only after a verified payment. So a bug in
     * the UI cannot publish an unpaid row.
     */
    t('the public board shows only paid listings', /filter\(\(r\) => isLive\(r, now\)\)/.test(server));
    t('...and only a verified payment can set the live window',
      /liveUntil: until/.test(server) && !/liveUntil = Date\.now/.test(server));
    /* Three tiers, one source of truth, cheapest first. */
    t('the price list is declared once', /export const TIERS = \[/.test(server));
    for (const [usd, days] of [[1, 1], [5, 7], [25, 30]]) {
      t(`...including $${usd} for ${days} day(s)`,
        new RegExp(`usd: ${usd}[^}]*\\}`).test(server.replace(/\s+/g, ' '))
        || new RegExp(`days: ${days}, usd: ${usd}`).test(server));
    }
    /*
     * The tier is derived from the amount RECEIVED, never from what the client
     * asks for — otherwise a $1 payment could request 30 days and get it.
     */
    t('the tier is decided by the amount actually paid', /tierForAmount/.test(server));
    t('...and rounds down rather than up', /paid \+ 1e-9 >= t\.usd/.test(server));

    /*
     * ─── PAYMENT IS VERIFIED, NOT BELIEVED ──────────────────────────────────
     * The browser says "I paid, here is the hash". If the server trusted that,
     * any 66-character string would buy a listing.
     */
    const promote = code(read('server/promote.js'));
    t('the promotion payment is checked against the chain',
      /eth_getTransactionReceipt/.test(promote));
    t('...the transfer must be to OUR address',
      /PROMO_RECIPIENT/.test(promote) && /topics\[2\]/.test(promote));
    t('...for at least the cheapest tier', /MIN_UNITS/.test(promote) && /value < MIN_UNITS/.test(promote));
    t('...on a transaction that actually succeeded', /receipt\.status/.test(promote));
    /*
     * The payer check stops somebody watching the chain for a large transfer
     * to us and claiming a stranger's payment as their own.
     */
    t('...sent by the wallet claiming it', /same\(receipt\.from, payer\)/.test(promote));
    /*
     * REPLAY. A valid hash stays valid forever, so without this one $25
     * payment could promote a listing every month, or be handed to a friend.
     */
    /*
     * ─── REAL BUG FOUND IN TESTING ──────────────────────────────────────────
     * A single `paidTx` field was overwritten on each renewal, so after a
     * second payment the FIRST hash was forgotten and could be replayed for
     * free days — by the buyer, or by anyone who read it off the public chain.
     * Every spent hash is now remembered.
     */
    t('a payment hash can only ever be spent once',
      /txAlreadyUsed/.test(server) && /txAlreadyUsed/.test(code(read('server/app.js'))));
    t('...and EVERY past payment stays blocked, not just the latest',
      /paidTxs/.test(server) && /paidTxs\.includes\(needle\)/.test(server));
    /* Rows written before the fix must keep blocking their hash after deploy. */
    t('...including rows written before that fix', /r\?\.paidTx === needle/.test(server));

    /* No API key: this must keep working if a key is rotated or revoked. */
    t('verification needs no API key', !/ALCHEMY|API_KEY|apiKey/i.test(promote));

    /*
     * ─── THE PAID PLAN IS CONFINED TO ONE SCREEN ────────────────────────────
     * Asked for explicitly: «نمیخام در صفحات دیگر این تبلیغات نشان داده شود».
     * The Pro upsell renders inside BoardPanel and nowhere else. Checked by
     * scanning every OTHER page and component for the panel or its class.
     */
    const files = [];
    for (const dir of ['src/pages', 'src/components']) {
      for (const f of readdirSync(dir)) {
        if (!f.endsWith('.jsx')) continue;
        if (f === 'BoardPanel.jsx') continue;
        files.push(join(dir, f));
      }
    }
    const leaked = files.filter((f) => /brd-pro|brd-tier|board\.publishTitle|payForPromotion/.test(read(f)));
    t(`the Pro upsell appears on no other screen${leaked.length ? ` — ${leaked.join(', ')}` : ''}`,
      leaked.length === 0);
    /* And it is only offered to someone who has something to promote. */
    t('...and is only shown when the user has a listing', /address && mine && tiers\.length > 0/.test(panel));
    /*
     * THE PRICE LIST IN A COLLAPSIBLE WARNING BOX — asked for explicitly. It
     * is built from the server's own tiers so the screen cannot advertise a
     * price the server will not honour.
     */
    t('the costs are shown in a collapsible warning box',
      /board\.costsTitle/.test(panel) && /tone="warn"/.test(panel));
    t('...built from the server price list, not hard-coded',
      /tiers\.map/.test(panel) && !/\$25|\$5\b/.test(panel.replace(/\$\{[^}]*\}/g, '')));
    t('...and warns that payment is final', /board\.costsRefund/.test(panel));

    /*
     * ─── USER TEXT IS RENDERED IN OTHER PEOPLE'S CLIENTS ────────────────────
     * Same rule UsernameField already applies: angle brackets and quotes are
     * removed outright rather than escaped, and bidi overrides are stripped
     * because they let a string visually reverse the text around it.
     */
    t('listing text is sanitised before storage', /BIDI/.test(server) && /\[<>"'`\\\\\]/.test(server));
    t('...and contact handles cannot carry a URL', /cleanContact/.test(server));

    /*
     * ─── FAILURE MODES THAT COST THE USER MONEY ─────────────────────────────
     * The money leaves the wallet before the claim call. If that call fails
     * the user must be told the payment SUCCEEDED, not that it failed —
     * otherwise they pay twice.
     */
    t('a failed claim after a successful payment does not report failure',
      /payClaimLater/.test(panel));
    /* Sending Base calldata on the wrong chain can hit a different contract. */
    t('the chain is re-checked after switching, before spending',
      /WRONG_CHAIN/.test(client) && /wallet\.chainId !== terms\.chainId/.test(client));
    /* Handing over a mempool hash would read as "payment rejected". */
    t('the payment waits for a confirmation before claiming', /tx\.wait/.test(client));

    /* Locale coverage, hand-written in both primary languages. */
    for (const lang of ['en', 'fa']) {
      const L = JSON.parse(read(`src/i18n/locales/${lang}.json`));
      t(`${lang} has the board copy`, Boolean(L.board?.title));
      t(`${lang} says plainly that nobody holds the money`,
        String(L.board?.safetyBody ?? '').length > 150);
      /* Toasts resolve `toast.<key>`; a missing one renders the raw key. */
      for (const k of ['boardPosted', 'boardFailed', 'payRejected', 'payWrongChain', 'payClaimLater']) {
        t(`${lang} has the ${k} toast`, Boolean(L.toast?.[k]));
      }
    }

    /* The tab must exist, and the other two must be untouched. */
    const p2p = code(read('src/pages/P2P.jsx'));
    t('the board is reachable as a third P2P tab', /'otc', 'fiat', 'board'/.test(p2p));
    t('...and the default tab is still OTC', /useState\('otc'\)/.test(p2p));
  }

  /* ---- 96. the community feed: rendered, never hosted -------------------- */
  {
    const code = (src) => src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    const server = code(read('server/farcaster.js'));
    const client = code(read('src/lib/community.js'));
    const panel = code(read('src/components/CommunityPanel.jsx'));

    /*
     * ─── WE RENDER A FEED, WE DO NOT HOST ONE ───────────────────────────────
     * Hosting posts would blow the free storage tier at ~50 users AND make us
     * the publisher of whatever a stranger writes. Asserted as an absence:
     * nothing here may write a post to our own store.
     */
    t('the feed is not stored in our own key-value store',
      !/storeSet|storeGet/.test(server));
    t('...and the client cannot post, reply or like',
      !/POST|method:\s*'POST'/.test(client));

    /*
     * No API key. Neynar is easier but needs one, and this project has had
     * keys rotated, revoked and geo-blocked — a revenue-adjacent feature must
     * not inherit that.
     */
    t('reading needs no API key', !/API_KEY|apiKey|x-api-key|neynar/i.test(server));

    /*
     * ─── THE THREE HUB QUIRKS, EACH FOUND BY CALLING THE REAL ENDPOINT ──────
     * 1. `reverse=true` does not reliably sort — the live channel query
     *    returned June casts next to December ones.
     */
    t('casts are sorted by us, not trusted from the hub', /sort\(\(a, b\) => b\.at - a\.at\)/.test(server));
    /* 2. Timestamps are seconds from 2021-01-01, not the Unix epoch. */
    t('the Farcaster epoch is applied', /FC_EPOCH_MS = 1609459200/.test(server));
    /* 3. The user_data_type filter is ignored, so the field must be picked out. */
    t('the username is selected from the full profile payload',
      /USER_DATA_TYPE_USERNAME/.test(server));

    /*
     * A caller-supplied channel URL would make this an open proxy for
     * arbitrary Farcaster content.
     */
    t('the channel is an allow-listed id, never a caller URL',
      /CHANNELS\[channel\]/.test(server) && /UNKNOWN_CHANNEL/.test(server));

    /*
     * Embed URLs are counted, never returned. Rendering a remote image from an
     * arbitrary poster leaks our users' IPs and hands a stranger a slot inside
     * our app.
     */
    t('embed URLs are counted, not exposed', /embeds: Array\.isArray\(body\.embeds\) \? body\.embeds\.length/.test(server));

    /* Posts are rendered in our UI, so the same bidi/control stripping applies. */
    t('cast text is sanitised', /BIDI/.test(server) && /cleanText/.test(server));

    /*
     * A dead third-party feed must never break the page it sits on. The client
     * swallows every failure and reports live:false instead.
     */
    t('a failing feed degrades instead of throwing', /return \{ rows: \[\], live: false \}/.test(client));
    t('...and the UI offers a retry', /common\.retry/.test(panel));

    /* Stale responses must not land under the wrong channel tab. */
    t('a slow response cannot overwrite a newer channel', /let alive = true/.test(panel));

    /* Cached, or every open would hit the hub for the same rows. */
    t('the feed is cached server-side', /withCache/.test(server));

    /* Copy: present, hand-written, and honest about what the feed is. */
    for (const lang of ['en', 'fa']) {
      const L = JSON.parse(read(`src/i18n/locales/${lang}.json`));
      t(`${lang} has the community copy`, Boolean(L.community?.title));
      t(`${lang} says the posts are not ours and not moderated`,
        String(L.community?.notice ?? '').length > 120);
      /* The tab label must exist or the button renders the raw key. */
      t(`${lang} labels the community tab`, Boolean(L.news?.tab?.community));
      t(`${lang} labels the board tab`, Boolean(L.p2p?.tab?.board));
    }

    /*
     * ─── THE FEED LIVES ON NEWS, NOT ON P2P ─────────────────────────────────
     * Moved on request. Asserted in BOTH directions, because a half-done move
     * would leave the panel mounted twice and the P2P tab strip rendering a
     * raw i18n key.
     */
    const p2p = code(read('src/pages/P2P.jsx'));
    const news = code(read('src/pages/News.jsx'));
    t('the feed is reachable as a News tab',
      /'read', 'whales', 'community', 'listen', 'insights', 'calm'/.test(news) ||
      /'read', 'community', 'listen', 'insights', 'calm'/.test(news));
    t('...and News actually renders the panel',
      /import CommunityPanel/.test(news) && /<CommunityPanel \/>/.test(news));
    t('...and P2P no longer mounts it',
      !/CommunityPanel/.test(read('src/pages/P2P.jsx')));
    t('...and the P2P tab strip is back to three tabs',
      /\['otc', 'fiat', 'board'\]/.test(p2p));
    t('...and OTC is still the default P2P tab', /useState\('otc'\)/.test(p2p));
    t('...and Headlines is still the default News tab', /useState\('read'\)/.test(news));
  }

  /* ---- 97. cancelling, the deleted sentence, and a cheap neon border ----- */
  {
    const code = (src) => src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    const panel = code(read('src/components/BoardPanel.jsx'));
    const css = read('src/index.css');

    /*
     * ─── AN UNPAID DRAFT MUST BE DELETABLE ──────────────────────────────────
     * There is a Remove button on the user's own row in the public list, but a
     * draft NEVER appears in that list — it is hidden from everyone including
     * its author. Without a second control the draft state had no way out.
     */
    t('a draft can be deleted from the panel itself', /board\.cancelDraft/.test(panel));
    t('...and a live advert can be cancelled too', /board\.cancelLive/.test(panel));
    t('...both wired to the delete call', /deleteListing/.test(code(read('src/lib/board.js'))));

    /* The owner asked for this sentence to go. */
    t('the "one advert per wallet" sentence is gone', !/oneEach/.test(panel));
    for (const lang of ['en', 'fa', 'ar']) {
      const L = JSON.parse(read(`src/i18n/locales/${lang}.json`));
      t(`${lang} no longer carries that string`, L.board?.oneEach === undefined);
      t(`${lang} has the cancel labels`, Boolean(L.board?.cancelDraft) && Boolean(L.board?.cancelLive));
    }

    /*
     * ─── THE NEON BORDER IS CSS, AND THAT IS THE WHOLE POINT ────────────────
     * The component that was proposed mounts ~18 nested divs per advert, six
     * of them blurred, and rebuilds two 27-stop conic gradients from
     * JavaScript on EVERY frame — 2,400 gradient rebuilds per second with 20
     * adverts on screen. The brief was explicitly "don't put the app under
     * strain", so it is one pseudo-element driven by an animated custom
     * property instead, reusing the `steps()` trick this file already uses for
     * .card-rgb.
     */
    t('the neon border exists', /\.brd-row-neon::before/.test(css));
    t('...and is not a per-frame JavaScript animation',
      !/requestAnimationFrame/.test(panel) && !/ResizeObserver/.test(panel));
    /* steps() is what turns 60 repaints per second into 10. */
    t('...repainting is quantised with steps()',
      /\.brd-row-neon::before[\s\S]{0,1200}?animation: rotate-angle [\d.]+s steps\(\d+\)/.test(css));
    /* An animated blur filter on a list row is the most expensive thing there
       is; the glow is a static shadow that never repaints. */
    t('...and the glow does not animate a blur filter',
      !/\.brd-row-neon[\s\S]{0,400}?filter:\s*blur/.test(css));

    /* Colour per tier, as asked: 1 day white, 7 grey, 30 gold. */
    for (const tier of ['d1', 'd7', 'd30']) {
      t(`the ${tier} border has its own colour`, new RegExp(`\\.brd-neon-${tier}\\b`).test(css));
    }
    t('...and the class is chosen from the tier that was paid for',
      /brd-neon-\$\{row\.tier\}/.test(panel));
    /* A row with no tier must not emit brd-neon-undefined. */
    t('...with no class at all when a row has no tier', /row\.tier \?/.test(panel));

    /*
     * A rotating border is exactly the motion that triggers vestibular
     * symptoms, and an unsupported @property would leave a bright arc frozen
     * in one corner looking like a rendering fault.
     */
    t('reduced motion stops the rotation but keeps the colour',
      /prefers-reduced-motion[\s\S]{0,200}?\.brd-row-neon::before \{ animation: none/.test(css));
    t('...and there is a fallback where @property is unsupported',
      /@supports not \(background: conic-gradient\(from var\(--angle\)[\s\S]{0,400}?brd-row-neon/.test(css));
  }

  /* ---- 98. real tickers on Stocks, and the perks released ---------------- */
  {
    const code = (src) => src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    const stocks = code(read('src/pages/Stocks.jsx'));
    const srv = code(read('server/avantis.js'));
    const appSrc = code(read('server/app.js'));

    /*
     * ─── A LIST, NOT A BANNER ───────────────────────────────────────────────
     * The first version of this block was one row saying "UTEX has hundreds of
     * tickers, tap here". The objection was exact: «فقط بنر تبلیغاتی نباشد».
     * So the whole chain has to exist — a missing link anywhere turns the
     * section back into an advert without anyone noticing.
     */
    t('the Avantis equity module exists', existsSync('server/avantis.js'));
    t('...the route is mounted', /['"`]\/api\/avantis\/equities['"`]/.test(appSrc));
    t('...and calls the fetcher', /fetchAvantisEquities/.test(appSrc));
    t('...the client library calls the route', /avantis\/equities/.test(code(read('src/lib/avantisEquities.js'))));
    t('...and Stocks renders the rows', /refRows\.map/.test(stocks));

    /*
     * Both upstreams must stay keyless. This project has had keys rotated,
     * revoked and geo-blocked; a revenue-adjacent screen must not inherit that.
     */
    t('the pair table needs no API key', !/API_KEY|apiKey|x-api-key|Authorization/i.test(srv));
    t('...and it is the public endpoint Avantis own SDK uses',
      /socket-api-pub\.avantisfi\.com\/socket-api\/v1\/data/.test(srv));

    /*
     * Group 6 is EQUITIES today, but a group index is POSITIONAL and Avantis
     * can reorder them. Matching the number would silently publish forex pairs
     * onto a stocks screen.
     */
    t('the equity group is matched by name, not by index',
      /EQUITY_GROUP = 'EQUITIES'/.test(srv) && /name \?\? ''\)\.toUpperCase\(\) === EQUITY_GROUP/.test(srv));

    /*
     * Number(null) is 0 and 0 is finite, so a missing Pyth price would render
     * as "$0.00" — a plausible, wrong number on a screen about money.
     */
    t('a missing price stays null and never becomes zero',
      /if \(raw === null \|\| raw === undefined/.test(srv));
    t('...and the row renders a dash rather than \$0.00',
      /r\.price \? `\$\$\{fmtPrice\(r\.price\)\}` : '—'/.test(stocks));

    /* Delisted pairs stay in the payload with isPairListed:false. */
    t('delisted pairs are dropped', /isPairListed === false/.test(srv));

    /*
     * leverageOverride is what actually binds — the live payload had pairs
     * whose base cap was 10x while the override held them at 2x. Showing the
     * base figure would overstate what the venue allows.
     */
    t('the binding leverage cap is the override where one is active',
      /leverageOverride/.test(srv) && /ovr\?\.active/.test(srv));

    /* Forty pairs must not mean forty outbound calls to a free endpoint. */
    t('all prices are fetched in one Hermes call',
      /rows\.map\(\(r\) => `ids\[\]=\$\{r\.feedId\}`\)\.join\('&'\)/.test(srv));

    /*
     * ─── FOUND ON THE LIVE ENDPOINT, NOT IN TESTING ─────────────────────────
     * The first deploy returned 27 correct rows and every single price null.
     * Cause: SPCX ships with feedId 0x0000…0000 and Hermes is ALL-OR-NOTHING —
     * one unknown id fails the whole batch with "Price ids not found", taking
     * every other price with it.
     *
     * Two independent defences, because the placeholder fixes the case we
     * found while the retry fixes the class: Avantis can list a pair before
     * Pyth publishes its feed at any time.
     */
    t('the all-zero placeholder feed is dropped', /if \(\/\^0\+\$\/\.test\(feedId\)\) return null;/.test(srv));
    t('...and an unknown id cannot blank every other price',
      /ignore_invalid_price_ids=true/.test(srv));
    /* A miss must leave the row null, never overwrite a good price with 0. */
    t('...with prices applied only where Hermes actually answered',
      /if \(hit\) r\.price = pythPrice\(hit\);/.test(srv));

    /* A dead price feed must not blank the section. */
    /*
     * Asserted structurally: the Hermes call is inside its own try/catch that
     * swallows, and `rows` is returned AFTER it. My first attempt at this
     * check matched an explanatory comment — comments are stripped above, so
     * it could never pass. Match the code.
     */
    t('a price failure still returns the list',
      /try \{[\s\S]{0,700}?hermes[\s\S]{0,700}?\} catch \{[\s\S]{0,80}?\}/i.test(srv) &&
      /return \{ rows, at: Date\.now\(\) \};\s*\}\s*$/m.test(srv));
    t('...and the client never throws', /return \{ rows: \[\], live: false \}/.test(code(read('src/lib/avantisEquities.js'))));

    /* US markets are shut most of the week in Tehran; an unlabelled price
       looks stale or broken. */
    t('market-hours state is carried through', /marketOpen/.test(srv) && /marketOpen === false/.test(stocks));

    /*
     * ─── WE ARE NOBODY'S FREE PROMOTER ON THIS SCREEN ───────────────────────
     * Instruction, verbatim: «لینک تبلیغاتی زیر سهام را حذف کن ما پروموت کننده
     * رایگان هیچ شرکتی نیستیم در صفحه سهام».
     *
     * The Avantis and UTEX buttons under the equity list are DELETED. Asserted
     * as an absence, in three independent ways, because a partial revert is
     * the realistic failure: someone re-adds one button, or re-imports the
     * referral helper "just in case".
     */
    t('no venue links remain on the Stocks screen',
      !/avantisfi\.com/.test(stocks) && !/utex\.io/.test(stocks));
    t('...and no referral code is attached anywhere on it',
      !/withReferral/.test(stocks));
    t('...and the referral module is not even imported',
      !/from '\.\.\/lib\/venueReferral'/.test(read('src/pages/Stocks.jsx')));

    /*
     * The table itself stays — the data was never the problem, the outbound
     * buttons were. It must still sit BELOW the tokenised equities we sell.
     */
    const iEquities = stocks.indexOf('stocks.available');
    const iRef = stocks.indexOf('stocks.ref.title');
    t('the reference table sits below what we actually sell',
      iEquities > 0 && iRef > 0 && iRef > iEquities);

    /*
     * ─── NO DUPLICATE COMPANIES ACROSS THE TWO LISTS ────────────────────────
     * A reference row with no button, directly under a buyable row for the
     * same company, reads as a broken buy flow. Alphabet is the case that
     * proves the suffix rule is not enough: Backed call it GOOGLx (class A)
     * and Avantis call it GOOG (class C), so stripping the x gives GOOGL vs
     * GOOG and Alphabet appeared twice. Found by diffing the live symbol
     * lists, not by reading the code.
     */
    t('reference rows exclude tickers we already sell', /const refRows = useMemo/.test(stocks));
    t('...matched with the xStock suffix stripped', /replace\(\/X\$\/, ''\)/.test(stocks));
    t('...and GOOG is aliased to GOOGL so Alphabet cannot appear twice',
      /ALIASES = \{ GOOG: 'GOOGL' \}/.test(stocks));

    for (const lang of ['en', 'fa', 'ar']) {
      const L = JSON.parse(read(`src/i18n/locales/${lang}.json`));
      const R = L.stocks?.ref;
      t(`${lang} has the reference-table copy`, Boolean(R?.title && R?.intro && R?.note));
      t(`${lang} labels closed markets`, Boolean(R?.closed) && Boolean(R?.openNow));
      /* Stale keys from the two previous versions of this block. */
      t(`${lang} no longer carries the advert-only copy`, L.stocks?.utex === undefined);
      t(`${lang} no longer carries the venue-link copy`, L.stocks?.other === undefined);
      /*
       * A price with no buy button has to say why, or it reads as broken.
       * The note must state BOTH that they are not sold here and that we are
       * not routing the reader anywhere.
       */
      t(`${lang} says these are reference prices, not for sale here`,
        String(R?.note ?? '').length > 80);
    }

    /*
     * ─── THE WARNINGS FOLD, BUT THEIR TITLES STILL CARRY THE FACT ───────────
     * Asked for: «هشدار را در صفحه باز شونده بزار». Both danger boxes lost
     * `defaultOpen`.
     *
     * That is only safe because of the second half: they previously shared the
     * SAME neutral title, "Read this before you buy". Collapsed, that would
     * have been two identical grey headers hiding both warnings behind a tap.
     * Each title now names its own risk, so folding hides the detail and not
     * the fact — and this check exists so a later edit cannot quietly restore
     * a neutral title.
     */
    t('the danger boxes start collapsed', !/defaultOpen/.test(stocks));
    for (const lang of ['en', 'fa', 'ar']) {
      const L = JSON.parse(read(`src/i18n/locales/${lang}.json`));
      t(`${lang} freeze title names the freeze risk`,
        /freeze|مسدود|تجميد/i.test(String(L.stocks?.freezeTitle ?? '')));
      t(`${lang} before-buy title says they are not shares`,
        /not shares|سهم نیستند|ليست أسهم/i.test(String(L.stocks?.beforeBuy?.title ?? '')));
      t(`${lang} the two titles are no longer identical`,
        String(L.stocks?.freezeTitle ?? 'a') !== String(L.stocks?.beforeBuy?.title ?? 'b'));
    }

    /*
     * ─── THE PERKS ARE RELEASED ─────────────────────────────────────────────
     * Asked for: «الان ازادش کن ... هر شخصی با هر امتیازی سهام ها را ببیند».
     * Both live venues were behind 6,000 and 15,000 points while the only perk
     * reachable early was GMX, which is not registered and pays nothing.
     */
    const perks = code(read('src/lib/perks.js'));
    t('perks are ungated for now', /const PERKS_UNGATED = true/.test(perks));
    t('...applied to the unlock decision', /PERKS_UNGATED \|\| reached/.test(perks));
    /*
     * The ladder is SUSPENDED, not deleted. The owner wants to design a promo
     * code later, and rebuilding the tier machinery then would be waste.
     */
    t('...but the tier ladder is kept for the promised promo-code design',
      /tierMeets\(userTier\.id, p\.tier\)/.test(perks) && /reached,/.test(perks));
  }

  /* ---- 99. the shop: a real catalogue, not a storefront mock ------------- */
  {
    const code = (src) => src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    const srv = code(read('server/shop.js'));
    const links = code(read('src/lib/shopLinks.js'));
    const client = code(read('src/lib/shop.js'));
    const page = code(read('src/pages/Shop.jsx'));
    const appSrc = code(read('server/app.js'));

    /* The whole chain, because "wired to nothing" is this repo's classic. */
    t('the shop module exists', existsSync('server/shop.js'));
    t('...the catalogue route is mounted', /['"`]\/api\/shop\/catalogue['"`]/.test(appSrc));
    t('...the products route is mounted', /['"`]\/api\/shop\/products['"`]/.test(appSrc));
    t('...the countries route is mounted', /['"`]\/api\/shop\/countries['"`]/.test(appSrc));
    t('...the client library calls them', /shop\/catalogue/.test(client) && /shop\/products/.test(client));
    t('...the page renders the catalogue', /ShopTile/.test(page) && /list\.slice\(0, PREVIEW\)/.test(page));
    t('...and the route is reachable', /path="\/shop"/.test(read('src/App.jsx')));
    t('...and it is in the menu', /to: '\/shop'/.test(read('src/components/MoreSheet.jsx')));

    /*
     * ─── COUNTRY IS THE WHOLE PRODUCT ───────────────────────────────────────
     * The catalogue differs per country and a card bought for the wrong one is
     * usually unrefundable — Steam say so in their own note. So it must be
     * ASKED, never inferred: browser locale is wrong for a Persian phone in
     * Dubai, and IP is wrong for anyone on a VPN, which is most of this
     * audience.
     */
    t('the country is asked, not guessed from locale or IP',
      /getShopCountry/.test(page) && !/navigator\.language/.test(page));
    t('...and remembered between visits', /setShopCountry/.test(client) && /localStorage/.test(client));
    t('...and every catalogue call is scoped to it', /country_code=\$\{cc\}/.test(srv));
    t('...with a per-country cache key, not one shared entry',
      /shop-cat-\$\{cc\}/.test(srv));

    /*
     * The provider REQUIRES the end user's IP and UA. `x-forwarded-for` is a
     * chain when several proxies are involved and the ORIGINAL client is the
     * FIRST entry — taking the last forwards our own edge IP and makes every
     * shopper look like the same person in a datacentre.
     */
    t('the end-user IP is forwarded, not our server IP',
      /x-forwarded-for[\s\S]{0,80}?\.split\(','\)\[0\]/.test(srv));

    /*
     * Third-party strings land in our UI, so the same defences as the board
     * and the Farcaster feed apply.
     */
    t('brand text is stripped of bidi and control characters', /BIDI/.test(srv) && /cleanText/.test(srv));
    t('...logos are accepted only from the provider CDN',
      /cdn\\.cryptorefills\\.com/.test(srv));
    t('...and colours are validated before being inlined as a style',
      /\^#\[0-9a-fA-F\]\{3,8\}\$/.test(srv));

    /*
     * Their tree nests the SAME brand under several categories — Amazon.com.tr
     * appears under e-commerce AND electronics. Rendering it verbatim shows
     * Amazon four times.
     */
    t('brands are de-duplicated across categories', /byId\.set\(b\.id, b\)/.test(srv));
    t('...and the filter list is built from what the country returned',
      /counts\.set/.test(srv) && !/const CATEGORIES = \[/.test(srv));

    /*
     * Number(null) is 0 and 0 is finite. The same reflex that renders a
     * missing price as "$0.00" also SORTS it to the front — caught by feeding
     * a null coin_amount through the real function, which put the unpriced
     * card at the top of the list.
     */
    t('a missing price stays null', /if \(v === null \|\| v === undefined \|\| v === ''\) return null;/.test(srv));
    t('...and unpriced rows sort last, not first',
      /if \(av === null\) return 1;/.test(srv) && /if \(bv === null\) return -1;/.test(srv));

    /* Out of stock is shown, not hidden: someone hunting for a brand should
       learn it is unavailable rather than conclude we never carried it. */
    t('out-of-stock brands are flagged rather than dropped',
      /outOfStock: b\.is_out_of_stock === true/.test(srv) &&
      /shop\.outOfStock/.test(read('src/components/ShopTile.jsx')));

    /*
     * ─── THE FORM WAS THE BUG, AND IT IS GONE ───────────────────────────────
     * v1 built a query string from origin/destination/dates. The owner caught
     * the flaw in one sentence: you fill it in here, then fill in the SAME
     * thing again on their site. True — their date pickers are React
     * components that ignore query parameters entirely, so the form cost time
     * and bought nothing.
     *
     * Only the PATH survives into their page, verified live:
     *   /en/flights/new_york-to-london -> JFK and LHR pre-selected
     *   /en/stays/ae/dubai             -> opens on Dubai
     *
     * So the form is replaced by real routes and cities with photographs.
     * Asserted as an ABSENCE too, because re-adding a date field is exactly
     * the "helpful" change that would bring the problem back.
     */
    t('the flight date form is gone', !/type="date"/.test(page));
    t('...and no dead query parameters are sent',
      !/departure_date|check_in|cabin_class/.test(links));
    t('...real routes are offered instead', /FLIGHT_ROUTES\.map/.test(page));
    t('...and real cities for stays', /STAY_CITIES\.map/.test(page));
    t('...each landing on a page that is already narrowed',
      /flightUrl\(r\.slug\)/.test(page) && /stayCityUrl\(c\.cc, c\.slug\)/.test(page));
    t('...and no fake fare list is invented', !/fare|itinerary|airlineResults/i.test(page));

    /*
     * Slugs are whitelisted by SHAPE, not trusted. A bad one must fall back to
     * the index page rather than build a URL that 404s — or worse, escape the
     * path with `../`.
     */
    const destSrc = read('src/lib/shopDestinations.js');
    t('flight slugs are validated before use', /\^\[a-z0-9_,-\]\+\$/.test(links));
    t('...and stay slugs too', /\^\[a-z\]\{2\}\$/.test(links));
    /* Every route/city here was read off their own pages; a typo is a 404. */
    t('the destinations use the provider CDN images',
      /cdn\.cryptorefills\.com\/images\/destinations/.test(destSrc));
    t('...and the flight slugs match their "x-to-y" format',
      /new_york-to-london/.test(destSrc) && /-to-/.test(destSrc));

    /*
     * ─── ONLY FILENAMES SEEN ON THEIR OWN PAGES ─────────────────────────────
     * I added Istanbul because it is an obvious destination for this audience
     * and invented `istanbul_turkey_200x250.webp` by pattern-matching the
     * others. It does not exist — the CDN answers AccessDenied — while every
     * filename actually read off their pages returns image bytes. The hotel
     * PAGE for Istanbul does work, so the tile would have linked correctly
     * and shown a broken image: plausible, half-working, invisible until a
     * user hits it.
     *
     * This pins the exact set that was verified. Adding a city means checking
     * its image first and then updating this list, which is the point.
     */
    const imgs = [...destSrc.matchAll(/\$\{IMG\}\/([a-z0-9_.]+\.webp)/g)].map((m) => m[1]);
    const VERIFIED = new Set([
      'london_uk_200x250.webp', 'dubai_uae_2_200x250.webp', 'tokyo_japan_200x250.webp',
      'paris_france_200x250.webp', 'rome_italy_200x250.webp',
      'amsterdam_netherlands_200x250.webp', 'miami_us_200x250.webp',
      'las_vegas_us_200x250.webp', 'los_angeles_us_200x250.webp',
      'toronto_canada_200x250.webp', 'san_francisco_us_200x250.webp',
      'new_york_us_200x250.webp', 'washington_dc_us_200x250.webp'
    ]);
    t('every destination image was verified against their CDN',
      imgs.length > 0 && imgs.every((f) => VERIFIED.has(f)));
    t('...and the invented Istanbul filename is gone', !/istanbul/i.test(destSrc.replace(/\/\*[\s\S]*?\*\//g, '')));

    /*
     * ─── THE REVIEW POINTS, EACH ASSERTED ───────────────────────────────────
     * Every one of these was a specific complaint, so each gets a guard rather
     * than a promise.
     */
    const css = read('src/index.css');
    const modernShop = read('src/styles/shop-modern.css');
    t('the modern storefront layer is loaded only with the lazy shop route',
      !/styles\/shop-modern\.css/.test(read('src/main.jsx')) &&
      /styles\/shop-modern\.css/.test(read('src/pages/Shop.jsx')));
    t('mobile products use a two-column grid and wide web grows to three',
      /repeat\(2, minmax\(0, 1fr\)\)/.test(modernShop) &&
      /repeat\(3, minmax\(0, 1fr\)\)/.test(modernShop));
    /*
     * iOS Safari computes an automatic intrinsic minimum for a lazy image
     * differently from Chromium. The preview rail reset that minimum, while
     * the full category grid did not — so tapping "see all" could collapse
     * cards into lines or make their columns wider than the viewport.
     */
    t('the full category grid resets intrinsic item sizing for iPhone Safari',
      /\.shop-grid > \*,[\s\S]{0,80}?\.shop-rail > \*[\s\S]{0,180}?min-width: 0/.test(modernShop) &&
      /grid-auto-rows: max-content/.test(modernShop));
    t('shop artwork keeps a visible stage while a lazy logo is unresolved',
      /\.shop-shot \{[\s\S]{0,100}?min-height: 96px/.test(modernShop) &&
      /\.shop-shot img \{[\s\S]{0,120}?height: auto/.test(modernShop));
    t('the storefront has integrated search, trust signals and a visual CTA',
      /shop-search/.test(page) && /shop-trust-row/.test(page) && /shop-promo-cta/.test(read('src/components/ShopPromo.jsx')));

    /* «خیلی کوچیکه عکس ها را بگتر کن» — a 16:9 stage, not a 34px icon. */
    t('brand art gets a real stage', /\.shop-shot \{[\s\S]{0,200}?aspect-ratio: 16 \/ 9/.test(css));
    /* «زیرش خیلی کوچک نباشه» — 14px, up from 12. */
    t('...and the brand name is not tiny',
      /\.shop-tile-name \{[\s\S]{0,120}?font-size: 14px/.test(css));

    /* «انتخاب کشورها حالت کشویی زشته» — no native select for 233 options. */
    t('the country picker is not a raw dropdown', !/<select/.test(page));
    t('...it is a searchable sheet with flags',
      existsSync('src/components/ShopCountrySheet.jsx') &&
      /cpick-flag/.test(read('src/components/ShopCountrySheet.jsx')));
    t('...with a shortlist ahead of all 233', /POPULAR_COUNTRIES/.test(read('src/components/ShopCountrySheet.jsx')));

    /* «هر کتگوری چندتا ... و بیشتر بره به صفحه ان دسته» */
    t('categories show a preview then open their own page',
      /const PREVIEW = \d+/.test(page) && /setOpenCat\(c\.id\)/.test(page));
    t('...and the category page renders that category only', /catRows\.map/.test(page));
    /* Back inside a category must return to the shop, not leave the screen. */
    t('...and back exits the category first', /if \(openCat\) setOpenCat\(null\)/.test(page));

    /* «تبلیغات ... با عکس نه اینکه فقط نوشتاری باشه» */
    t('the promo banners carry real artwork',
      /shop-promo/.test(page) && /\.shop-promo img/.test(css));

    /* Animation reuses the existing @property, rather than adding a second
       animation system for one screen. */
    t('the animated border reuses the existing rotate-angle',
      /\.shop-glow::before[\s\S]{0,400}?animation: rotate-angle [\d.]+s steps\(\d+\)/.test(css));
    t('...and stops under reduced motion',
      /prefers-reduced-motion[\s\S]{0,400}?\.shop-glow::before \{ animation: none/.test(css));

    /*
     * ─── THEIR PROSE IS HTML, AND WE WERE PRINTING THE TAGS ─────────────────
     * Reported by the owner, verbatim from the screen:
     *   <p><strong>#protip</strong></p><p>Redeeming with a VPN may violate…
     *
     * Their `rich_description.markup` field is literally "html", so note and
     * how_to_redeem are HTML fragments. `cleanText` stripped only control
     * characters, so React printed the markup.
     */
    t('provider prose is converted from HTML to text', /function htmlToText/.test(srv));
    t('...and the note goes through it', /note: htmlToText\(/.test(srv));
    t('...and the redemption steps too', /howTo: htmlToText\(/.test(srv));
    /*
     * NEVER dangerouslySetInnerHTML. This is third-party copy about money,
     * arriving over the network; injecting a stranger's HTML into a wallet app
     * to tidy a paragraph is a catastrophic trade for a cosmetic gain.
     */
    t('...without ever injecting their HTML',
      !/dangerouslySetInnerHTML/.test(page) && !/dangerouslySetInnerHTML/.test(srv));
    /* Script CONTENT must go with the tag, or the javascript stays as text. */
    t('...script bodies are removed, not just their tags',
      /<\(script\|style\)/.test(srv));
    /* A generic numeric-entity decoder would re-introduce the exact control
       and bidi characters this file exists to strip. */
    t('...entities decode from a fixed safe table', /const ENTITIES = \{/.test(srv));

    /*
     * ─── THE BUG THAT COST AN HOUR, PINNED ──────────────────────────────────
     * BIDI is /[…\u0000-\u001F…]/ and U+000A is inside that range, so
     * `s.replace(BIDI, '')` deleted every newline htmlToText had just
     * inserted. Output was "• One.• Two.Three." on one line while every
     * replacement literal was provably a real newline — which is why it kept
     * looking like an escaping fault when it was not.
     */
    t('the control-character strip preserves newlines',
      /u0000-\\u0008\\u000B-\\u001F/.test(srv));
    /* And the UI has to honour them, or the server work is invisible. */
    /*
     * Both places, asserted individually. Counting ">= 2" was too loose:
     * changing ONE of them to 'normal' still left two matches elsewhere and
     * the mutation passed when it should have failed.
     */
    t('...and the note renders its line breaks',
      /products\?\.note &&[\s\S]{0,220}?whiteSpace: 'pre-line'/.test(page));
    t('...and so do the redemption steps',
      /products\?\.howTo &&[\s\S]{0,320}?whiteSpace: 'pre-line'/.test(page));

    /* The redemption steps were fetched and never shown at all. */
    t('the redemption steps are actually displayed', /products\.howTo/.test(page));

    /*
     * ─── RESTRICTIONS: FULLER, AND STILL FOLDED ─────────────────────────────
     * «محدودیت ها را با باز شونده بنویس کاملتر کن». Five separate facts, not
     * one paragraph — a wall of text inside a collapsible is still a wall of
     * text once opened.
     */
    t('the restrictions are a list, not one paragraph', /shop-limits/.test(page));
    t('...still inside a collapsible', /id="shop-limits"/.test(page));

    /* Motion: cheap, CSS-only, and disabled under reduced motion. */
    t('tiles have press feedback', /\.shop-tile:active \.shop-shot::after/.test(css));
    t('...and destination photos respond to a press', /\.shop-dest:active img/.test(css));
    t('the loading skeleton matches the tile shape', /\.shop-sk-shot/.test(css) && /shop-sk-line/.test(page));
    t('...and every shop animation stops under reduced motion',
      /prefers-reduced-motion[\s\S]{0,400}?\.shop-sk-shot::after \{ animation: none/.test(css));
    /*
     * A blur or a rAF loop in a list of twenty tiles is the mistake the advert
     * borders already taught us not to repeat.
     *
     * My first version of this matched any `filter: blur` near a .shop rule
     * and failed on the route pill's STATIC backdrop-filter, which is painted
     * once and costs nothing per frame. The property that matters is that no
     * KEYFRAME animates a blur, and that nothing here runs a JS animation
     * loop.
     */
    t('...no keyframe animates a blur',
      !/@keyframes shop-[a-z-]+ \{[\s\S]{0,300}?filter:\s*blur/.test(css));
    t('...and no per-frame JavaScript drives the motion',
      !/requestAnimationFrame/.test(page) && !/requestAnimationFrame/.test(read('src/components/ShopTile.jsx')));

    /*
     * ─── THE 404 BUG: I INVENTED THE BRAND URL ──────────────────────────────
     * Reported: most card pages 404. They did. I had built
     * `/en/buy/{brand}?country=TR`, a path that does not exist — confirmed by
     * opening /en/buy/steam and getting "We couldn't find that page".
     *
     * The real grammar, read off their own catalogue links and each verified
     * to load:
     *   /en/turkiye/gift_cards/steam
     *   /en/united_states/gift_cards/amazon.com
     *   /en/united_arab_emirates/gift_cards/noon
     *
     * Two traps in it. The country segment is a NAME slug (`turkiye`) not the
     * ISO code, so a map is unavoidable; and DOTS MUST SURVIVE the brand slug,
     * because their Amazon link is literally `amazon.com` and my first
     * punctuation strip turned it into `amazon-com`.
     */
    t('brand links use the country/gift_cards/brand path',
      /\$\{country\}\/gift_cards\/\$\{slug\}/.test(links));
    t('...never the invented /buy/ path', !/\/buy\//.test(links));
    t('...with a name slug, not the ISO code', /const COUNTRY_SLUG = \{/.test(links) && /TR: 'turkiye'/.test(links));
    t('...and dots kept so amazon.com resolves', /\[\^a-z0-9\.\]\+/.test(links));
    /* An unmapped country must not dead-end; their global brand page carries
       its own country picker. Verified /en/steam-bitcoin loads. */
    t('...and an unmapped country falls back to a real page', /-bitcoin`/.test(links));

    /*
     * ─── LINKS OPEN INSIDE THE APP ──────────────────────────────────────────
     * «امکان داره در خود اپ باز شه بهتره بخصوص در اپ». lib/browser.js already
     * existed and this screen simply was not using it — every tap kicked the
     * user out to Chrome and lost the app.
     */
    t('shop links open in the in-app browser', /openUrl/.test(page));
    t('...rather than throwing the user out to a new tab',
      !/window\.open/.test(page));

    /*
     * ─── FIVE TABS, EACH WITH AN SVG ────────────────────────────────────────
     * «تب های بیشتر باشه و هر تب تصویر svg داشته باشد». PayPal/Visa and
     * top-up/eSIM were unreachable: e-money was one rail among thirty, and
     * eSIM was a single row at the foot of Stays.
     */
    const icons = read('src/components/ShopIcons.jsx');
    t('the shop has five tabs', (page.match(/\{ id: '[a-z]+', Icon: Icon[A-Za-z]+ \}/g) ?? []).length === 5);
    t('...each carrying an icon component', /<Icon width=/.test(page));
    t('...drawn as real SVG paths', (icons.match(/<svg /g) ?? []).length >= 5);
    t('...that inherit the theme colour', /stroke: 'currentColor'/.test(icons) && !/fill="#/.test(icons));

    /* «برای هر کتگوری پر رنگ تر باشه عنوانش» — 11px grey uppercase became a
       16px title with an accent bar. */
    t('category headings are prominent',
      /\.shop-cat-title \{[\s\S]{0,160}?font-size: 16px/.test(css) && /shop-cat-title/.test(page));

    /* Attribution in ONE place, so it cannot be forgotten on a new link —
       the Avantis bug, where a working link credited nobody. */
    t('every outbound link is built in one module', /function withRef/.test(links));
    t('...and the registered partner id is the compiled default',
      /VITE_CRYPTOREFILLS_PARTNER_ID'\) \|\| 'mYf7QvsDKa'/.test(links));
    t('...on the server side too, so catalogue calls are attributed',
      /CRYPTOREFILLS_PARTNER_ID \|\| 'mYf7QvsDKa'/.test(srv));
    t('...with the disclosure derived from it rather than hard-coded',
      /shopEarns\(\)/.test(page) && /Boolean\(CR_PARTNER\)/.test(links));

    /* A whole screen on one third party must degrade, never throw. */
    t('a dead upstream returns empty instead of throwing',
      /return \{ rows: \[\], categories: \[\], live: false \}/.test(client));
    t('...and the page says so', /shop\.unavailable/.test(page));

    /*
     * Asked for explicitly: a collapsible for the restrictions, and NOT lots
     * of explanation or warnings. One folded box, short factual list.
     */
    t('the restrictions are in a collapsible box', /id="shop-limits"/.test(page));
    t('...and there is no wall of warning notices', (page.match(/notice-danger/g) ?? []).length === 0);

    /*
     * Revenue was the point, and the adverts stay — but as PICTURES now, which
     * is what was asked for: «تبلیغات ... با عکس نه اینکه فقط نوشتاری باشه».
     * The old text-and-emoji AdBanner is deliberately not used here.
     */
    /*
     * Counts the BANNER, not the class name. My first version matched
     * /shop-promo/ which also hits shop-promo-txt, -kicker and -title — four
     * matches per banner — so deleting one still left the count above the
     * threshold and the mutation test passed when it should have failed.
     */
    t('the shop carries more than one picture advert',
      (page.match(/className="shop-promo shop-glow"/g) ?? []).length >= 2);
    t('...and each is an image, not an emoji in a box',
      (page.match(/className="shop-promo shop-glow"[\s\S]{0,300}?<img/g) ?? []).length >= 2);

    for (const lang of ['en', 'fa', 'ar']) {
      const L = JSON.parse(read(`src/i18n/locales/${lang}.json`));
      const S = L.shop;
      t(`${lang} has the shop copy`, Boolean(S?.title && S?.subtitle && S?.pickCountry));
      t(`${lang} labels all three tabs`,
        Boolean(S?.tab?.cards && S?.tab?.flights && S?.tab?.stays));
      t(`${lang} labels the destination sections`,
        Boolean(S?.flight?.popular && S?.stay?.popular));
      t(`${lang} has the picture-promo copy`, Boolean(S?.promo?.kicker && S?.promo?.flights));
      /* Dead keys from the removed form must not linger. */
      t(`${lang} dropped the old form copy`, S?.flight?.depart === undefined);
      /*
       * The restrictions are five keys now, not one `body` paragraph. Joined
       * before testing so the checks describe the CONTENT rather than the
       * shape it happens to be stored in.
       */
      const lim = ['l1', 'l2', 'l3', 'l4', 'l5'].map((k) => String(S?.limits?.[k] ?? '')).join(' ');
      t(`${lang} names the countries that do not work`, /Iran|ایران|إيران/.test(lim));
      t(`${lang} warns that a VPN does not defeat the region lock`,
        /VPN|وی‌پی‌ان/.test(lim));
      t(`${lang} says who actually takes the money`, /Cryptorefills/.test(lim));
      t(`${lang} has all five restriction points`,
        ['l1', 'l2', 'l3', 'l4', 'l5'].every((k) => String(S?.limits?.[k] ?? '').length > 40));
      t(`${lang} dropped the old single-paragraph copy`, S?.limits?.body === undefined);
      t(`${lang} explains why the country matters`,
        String(S?.pickCountryWhy ?? '').length > 60);
      t(`${lang} states both earning and non-earning disclosures`,
        Boolean(S?.earning) && Boolean(S?.noEarn));
      t(`${lang} labels the shop in the menu`, Boolean(L.nav?.shop));
    }
  }

  /* ---- 100. logos, legibility and the promo slideshow ------------------- */
  {
    const code = (src) => src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    const css = read('src/index.css');
    const shop = code(read('src/pages/Shop.jsx'));

    /*
     * ─── THE STOCK LOGOS WERE BEING CROPPED AWAY ────────────────────────────
     * Reported: company logos do not appear on the Stocks screen. The server
     * sends a valid `icon` for every xStock and tokenIcon.jsx reads it — the
     * failure was purely visual. `.tok-icon img` used `object-fit: cover`,
     * which fills a CIRCLE by cropping, and the xStocks artwork is a square
     * PNG with the mark inset in padding. Cropping kept the padding and threw
     * away the mark, leaving an empty disc that reads as a broken image.
     */
    t('token logos are fitted, not cropped',
      /\.tok-icon img \{[\s\S]{0,700}?object-fit: contain/.test(css));
    /* Several issuer logos are white-on-transparent, i.e. invisible on the
       light theme without a backdrop behind them. */
    t('...on a backdrop so white artwork still shows',
      /\.tok-icon \{[\s\S]{0,400}?background: color-mix/.test(css));

    /*
     * ─── HEADINGS WERE QUIETER THAN THE BODY TEXT ───────────────────────────
     * «عنوان های هر چیزی خیلی کم رنگه مثلا طلا». `.section-label` was 10.5px
     * uppercase mono, 0.18em tracked, in --text-3 — the lowest-contrast ink in
     * the palette. Five compounding choices, each subtracting legibility, on a
     * class used across most screens.
     */
    t('section headings are legible',
      /\.section-label \{[\s\S]{0,260}?font-size: 12\.5px/.test(css));
    t('...and not the lowest-contrast ink',
      !/\.section-label \{[\s\S]{0,300}?color: var\(--text-3\)/.test(css));

    /*
     * ─── THE PROMO IS A SLIDESHOW NOW ───────────────────────────────────────
     * «چندتا عکس بزار چند ثانیه یکبار با عنوان جدید عوض بشه اسلایدی باشه».
     */
    t('the promo banner rotates through slides', existsSync('src/components/ShopPromo.jsx'));
    const promo = code(read('src/components/ShopPromo.jsx'));
    const imgsSrc = read('src/lib/shopImages.js');
    t('...with more than one slide',
      /export const PROMO_SLIDES = \[/.test(imgsSrc) && (imgsSrc.match(/\{ id: 'p-/g) ?? []).length >= 3);
    t('...each with its own headline', /t\(s\.title\)/.test(promo));

    /*
     * A carousel is where apps burn battery. ONE interval, cleared on unmount,
     * and stopped entirely by the existing useStill() guard — the same one
     * AdBanner uses for reduced motion and native.
     */
    t('...driven by a single interval', (promo.match(/setInterval/g) ?? []).length === 1);
    t('...that is cleared on unmount', /clearInterval/.test(promo));
    t('...and does not run under reduced motion', /if \(still/.test(promo));
    /* Opacity only: no layout, no blur, no filter animation on a photograph. */
    t('...cross-fading on opacity alone',
      /initial=\{\{ opacity: 0 \}\}/.test(promo) && !/filter:/.test(promo));

    /*
     * The old gradient ran to 80% black across the whole frame, which is what
     * made the image look «کم رنگ و زشت» — it was a dark smear, not a photo.
     */
    t('the promo veil no longer swallows the photograph',
      /\.shop-promo-txt \{[\s\S]{0,600}?rgba\(0, 0, 0, \.72\) 0%/.test(css));
    t('...and slide position is shown', /shop-promo-dots/.test(css) && /shop-promo-dots/.test(promo));

    /*
     * ─── RESOLUTION WAS THE PROBLEM, NOT THE GRADIENT ───────────────────────
     * Reported twice as washed out. The provider's destination photos exist at
     * exactly one size, 200x250 — `_400x500` and `_600x750` both return
     * AccessDenied — so a full-width banner was upscaling them roughly six
     * times. These are 1280px instead, which is a downscale.
     *
     * Also asked for Iran, and the provider has no Iranian destination at all
     * because Iran is not among the 233 countries they serve.
     */
    t('promo art is high resolution', /1280px-/.test(imgsSrc));
    t('...and no longer the 200px provider thumbnails',
      !/200x250/.test(code(imgsSrc)));
    t('...with Iranian landmarks in the rotation',
      /Si-o-se-Pol/.test(imgsSrc) && /Naghsh-e_Jahan|Lotfollah/.test(imgsSrc));

    /*
     * These are Creative Commons with AttributionRequired — read off the
     * Commons API, not assumed. Naming the author is a LICENCE CONDITION, so
     * shipping them uncredited would be a copyright violation. Asserted on
     * the data and on the render, because either half alone is useless.
     */
    t('every promo image carries a credit and licence',
      (imgsSrc.match(/credit: '/g) ?? []).length >= 4 &&
      (imgsSrc.match(/licence: 'CC /g) ?? []).length >= 4);
    t('...and the credit is actually rendered',
      /shop-promo-credit/.test(read('src/components/ShopPromo.jsx')) &&
      /s\.img\.credit/.test(read('src/components/ShopPromo.jsx')));

    for (const lang of ['en', 'fa', 'ar']) {
      const L = JSON.parse(read(`src/i18n/locales/${lang}.json`));
      const P = L.shop?.promo;
      t(`${lang} has a headline for every slide`,
        Boolean(P?.flights && P?.stays && P?.cards && P?.esim));
    }
  }

  /* ---- 101. FBT, and the CDN cache that was making the site slow -------- */
  {
    const code = (src) => src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    /*
     * ─── THE SITE GOT SLOWER, AND THIS WAS WHY ──────────────────────────────
     * Every cached response set `max-age` only. That is a BROWSER directive;
     * Vercel's CDN ignores it and treats the response as private, so every
     * request from every user woke a serverless function.
     *
     * Measured on the live site rather than guessed: /api/health reported
     * `uptime: 33s`, then `38s` a moment later — the instance had just been
     * created — with `cache.entries: 2` on a server that caches dozens of
     * endpoints. The in-memory cache was being discarded constantly, so almost
     * every call was a cold start plus a full upstream fetch.
     *
     * `s-maxage` is what a shared cache reads; `stale-while-revalidate` means
     * that past the TTL the edge answers instantly from the stale copy and
     * refreshes behind the request, so nobody waits for a cold start.
     */
    const appSrc = read('server/app.js');
    t('cached responses are cacheable by the CDN, not just the browser',
      /s-maxage=\$\{secs\}/.test(appSrc));
    t('...and serve stale while they refresh', /stale-while-revalidate=\$\{secs \* 4\}/.test(appSrc));
    /* Every hand-rolled header too, or those routes still cold-start per user. */
    t('...on every hand-written cache header as well',
      !/'public, max-age=\d+'/.test(appSrc));

    /*
     * ─── FBT: A LOYALTY BALANCE, NOT A COIN ─────────────────────────────────
     * Asked for our own token. A real one needs a liquidity pool — actual
     * money, locked — and the 2026 market rate for a working launch is
     * $35k-$280k against a standing "no money to spend" rule. So this is the
     * free, honest half: the points that were already accruing, given a name,
     * a symbol and a job.
     */
    t('the FBT module exists', existsSync('src/lib/fbt.js'));
    const fbt = code(read('src/lib/fbt.js'));
    const panel = code(read('src/components/FbtPanel.jsx'));

    /* It is built ON the existing points, not a second parallel ledger. */
    t('FBT is derived from the existing points', /s\.points/.test(panel));
    t('...and is mounted where the points already live', /FbtPanel/.test(read('src/pages/Leaderboard.jsx')));

    /*
     * The single most important property in this feature. A balance with a
     * symbol and a tier ladder LOOKS like a token; if a user concludes they
     * own something sellable, that is both a broken promise and the thing that
     * would turn a discount scheme into an unregistered offering.
     */
    /*
     * My first version of this checked `!/InfoBox[^>]*fbt.notCoin/`, which
     * cannot match because the key sits in the CHILDREN of the element, not in
     * its attributes — wrapping the line in an InfoBox left the guard green.
     * Assert the positive shape instead: it must be the plain .fbt-note
     * paragraph, which by construction cannot be inside a collapsible.
     */
    t('the not-a-coin line is always visible, never collapsed',
      /<p className="fbt-note">\{t\('fbt\.notCoin'\)\}<\/p>/.test(panel));
    for (const lang of ['en', 'fa', 'ar']) {
      const L = JSON.parse(read(`src/i18n/locales/${lang}.json`));
      const F = L.fbt;
      t(`${lang} has the FBT copy`, Boolean(F?.title && F?.notCoin && F?.howTitle));
      /*
       * Matches the CLAIM, not one exact phrasing. My first version required
       * "ليست عملة" and the correct Arabic here is "ليس عملة" — the guard was
       * wrong, not the translation, and pinning a whole sentence would break
       * on any future rewording that still says the same thing.
       */
      t(`${lang} says it cannot be sold or withdrawn`,
        /cannot be sold or withdrawn|فروختنی و برداشت‌شدنی نیست|لا يمكن بيعه أو سحبه/.test(String(F?.notCoin ?? '')));
      t(`${lang} states it is not tradable`,
        /not a tradable coin|ارز قابل معامله نیست|ليس عملة قابلة للتداول/.test(String(F?.notCoin ?? '')));
      t(`${lang} promises no date and no value for a real token`,
        /do not promise a date|نه تاریخی قول می‌دهیم|لا نعد بتاريخ/.test(String(F?.how?.h4 ?? '')));
      t(`${lang} names every tier`,
        ['base', 'bronze', 'silver', 'gold', 'diamond'].every((k) => Boolean(F?.tier?.[k])));
    }

    /* Number(null) is 0 and 0 is finite — the trap that has produced "$0.00"
       twice in this codebase. Guarded explicitly here. */
    t('a bad balance cannot become a tier', /!Number\.isFinite\(n\) \|\| n <= 0/.test(fbt));
    /* A mis-edited table must not be able to produce a negative or inflated
       fee, so the discount is clamped at both ends independently of it. */
    t('the discount is hard-capped', /MAX_DISCOUNT_BPS = 20/.test(fbt) && /Math\.min\(MAX_DISCOUNT_BPS/.test(fbt));
    t('...and can never exceed the base fee', /Math\.max\(0, Math\.min\(base, base - disc\)\)/.test(fbt));

    /*
     * The fee discount is DISPLAYED but not yet applied to the live swap, and
     * that stop is deliberate: FEE_BPS is threaded through the aggregator
     * quote AND the hand-encoded calldata, and a quote built with one fee and
     * a transaction carrying another does not misprint a number, it reverts.
     * The copy must not claim a discount that is not active.
     */
    t('the swap path is untouched for now', !/feeBpsFor/.test(read('src/lib/swap.js')));
    for (const lang of ['en', 'fa', 'ar']) {
      const L = JSON.parse(read(`src/i18n/locales/${lang}.json`));
      t(`${lang} does not claim the fee discount is live yet`,
        /soon|به‌زودی|قريباً/.test(String(L.fbt?.perkFee ?? '')));
    }
  }

  /*
   * ─── BUILDER CODES: THE FACTS, AND THE PROMISE NOT TO OVERSTATE THEM ──────
   * Asked whether we could take a commission on other venues' futures and spot
   * through an API, with a link to the CCXT spec. The answer is builder codes,
   * not CCXT — see docs/CCXT-BUILDER-CODES-FA.md.
   *
   * Two failure modes this section exists to prevent, and they pull in
   * opposite directions:
   *
   *   1. Claiming revenue we do not have. A builder code only pays when WE
   *      build and submit the order; there is no link to decorate and no env
   *      var to set. Reporting it as `ready` would be the fourth
   *      "wired to nothing" bug here.
   *   2. Losing the research. The numbers below were read out of each venue's
   *      own docs; an undocumented constant is one that gets "tidied" into
   *      something wrong six months from now.
   */
  {
    /* Redeclared: `code` is block-scoped per section in this file. */
    const code = (src) =>
      String(src)
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/(^|[^:])\/\/.*$/gm, '$1 ');

    t('the builder-code module exists', existsSync('src/lib/builderCodes.js'));
    const bc = code(read('src/lib/builderCodes.js'));

    /*
     * The rate. Pinned to the literal, because a generic /BUILDER_BPS_DEFAULT/
     * would pass for 5, 50 or the venue cap — the exact "a check that passes
     * for the right AND the wrong value" trap already hit here several times.
     */
    t('our builder fee is 5 bps, Phantom\u2019s rate and not the venue cap',
      /const BUILDER_BPS_DEFAULT = 5;/.test(bc));
    /*
     * And our own ceiling is 10, well under every venue's. Ostium allows 50,
     * dYdX and Hyperliquid-spot allow 100. A misconfigured env var must not be
     * able to reach those.
     */
    t('...and our own cap is 10, far below what the venues permit',
      /const BUILDER_BPS_MAX = 10;/.test(bc));
    t('...with an out-of-range value falling back rather than clamping',
      /n > BUILDER_BPS_MAX/.test(bc) && /return BUILDER_BPS_DEFAULT;/.test(bc));

    /*
     * Null guards FIRST. Number(null) is 0 and 0 is finite, which is how this
     * codebase has printed "$0.00" twice. Assert the explicit null check, not
     * just the presence of isFinite.
     */
    t('a null notional cannot become a zero fee',
      /if \(notionalUsd == null \|\| bps == null\) return null;/.test(bc));

    /*
     * The honesty function. A perp fee is charged on NOTIONAL, so at 20x our
     * 5 bps is 1% of the trader's actual capital. Any screen showing the bps
     * must be able to show this beside it.
     */
    t('the fee can be expressed against the user\u2019s real capital',
      /export function feeAsPctOfCollateral/.test(bc));

    /*
     * The number that justifies the whole exercise: a builder fee is ours in
     * full, a referral is a slice of somebody else's. Avantis pays 5% of a
     * 0.04% fee, so 5 bps is 25x better per dollar routed.
     */
    t('the referral comparison is computed, not asserted in prose',
      /export function referralMultiple/.test(bc));
    /* Dividing by a zero referral would give Infinity, and "infinitely
       better" is not a number anyone can act on. */
    t('...and a zero-paying referral returns null, never Infinity',
      /if \(referralBps <= 0\) return null;/.test(bc));

    /*
     * Venue facts. Each pinned to its literal so a future edit that "rounds"
     * one has to come through this test. Ostium 50 bps and dYdX 100 bps are
     * from their own developer docs.
     */
    /*
     * ─── `[^}]` IS THE FENCE; A CHARACTER BUDGET IS NOT ─────────────────────
     * These started as `venue: \{[\s\S]{0,400}?field` and two of them were
     * useless: flipping Ostium's `permissionless` to false stayed GREEN,
     * because the non-greedy match ran straight past the closing brace and
     * matched DRIFT's `permissionless: true` instead. Guessing a window width
     * is guessing; `[^}]*?` physically cannot leave the venue's own block.
     */
    t('Ostium is recorded as permissionless and free',
      /ostium: \{[^}]*?capBps: 50,/.test(bc) &&
      /ostium: \{[^}]*?setupCostUsd: 0,/.test(bc));
    /*
     * ─── A WINDOW WIDE ENOUGH TO REACH THE NEXT VENUE IS NO WINDOW ──────────
     * My first version was `hyperliquid: \{[\s\S]{0,700}?refundable: true`.
     * Flipping Hyperliquid to `refundable: false` left it GREEN, because the
     * non-greedy match simply ran on and found Drift's `refundable: true`
     * inside the same 700 characters. Anchor the two fields to each other
     * instead: `refundable` must be the line that follows `setupCostUsd: 100`.
     *
     * This distinction is the whole point of the row — 100 USDC that stays
     * ours is a deposit, and the moment it reads as a purchase it belongs in a
     * different column under a no-spending rule.
     */
    t('Hyperliquid\u2019s 100 USDC is recorded as refundable, not as a purchase',
      /setupCostUsd: 100,\s*refundable: true,/.test(bc));
    /* Ostium and dYdX cost nothing, so "refundable" there is trivially true;
       the claim that matters is that neither needs permission. */
    t('...and the two free venues are recorded as permissionless',
      /ostium: \{[^}]*?permissionless: true,/.test(bc) &&
      /dydx: \{[^}]*?permissionless: true,/.test(bc));

    /*
     * ─── THE CORRECTION, GUARDED ────────────────────────────────────────────
     * venueReferral.js says dYdX earns us nothing because of a $10,000 volume
     * floor. That is true of their AFFILIATE programme and false of builder
     * codes, whose docs say no approval is required at all. If someone deletes
     * this note the old wrong belief quietly returns.
     */
    t('the dYdX volume-floor correction is recorded',
      /correctsPreviousClaim:/.test(bc) && /dydx: \{[^}]*?setupCostUsd: 0,/.test(bc));

    /*
     * Ordering: cheapest first. Explicitly NOT by cap — sorting by what pays
     * us most is the "route the user to the worse product" failure this
     * project has refused twice already.
     */
    t('venues are ordered by what they cost us, not by what they pay us',
      /a\.setupCostUsd - b\.setupCostUsd/.test(bc) && !/capBps - a\.capBps/.test(bc));

    /*
     * ─── READINESS MUST SAY "NOT BUILT" ─────────────────────────────────────
     * The whole point of /api/revenue/readiness is that the owner cannot read
     * source and has been told "it's ready, just set the variable" for things
     * that were not. These four are genuinely not built.
     */
    const rd = read('server/readiness.js');
    const rdc = code(rd);
    for (const id of ['builder-ostium', 'builder-dydx', 'builder-hyperliquid', 'builder-drift']) {
      t(`readiness lists ${id}`, new RegExp(`id: '${id}'`).test(rdc));
    }
    /*
     * My first version of this checked `/ready: false/.test(rdc)` — which was
     * already true elsewhere in the file (kyberswap-key), so it passed no
     * matter what these four said. Window from each id to its own `ready`.
     */
    /*
     * Ostium has since been BUILT and moves to its own pair of checks further
     * down; these three are still research only. Listing it here as well would
     * have been a guard asserting the opposite of the truth.
     */
    for (const id of ['builder-hyperliquid', 'builder-drift']) {
      t(`...and does not claim ${id} is built`,
        new RegExp(`id: '${id}',[\\s\\S]{0,120}?ready: false`).test(rdc));
    }
    for (const id of ['builder-hyperliquid', 'builder-drift']) {
      t(`...nor that ${id} is earning`,
        new RegExp(`id: '${id}',[\\s\\S]{0,160}?live: false`).test(rdc));
    }
    t('the completed Ostium order path is live',
      /id: 'builder-ostium',[\s\S]{0,160}?live: true/.test(rdc));
    t('the completed dYdX order path is live',
      /id: 'builder-dydx',[\s\S]{0,160}?live: true/.test(rdc));
    const dydx = read('src/lib/dydx.js');
    t('dYdX orders carry the supplied payout address and 500 ppm fee',
      /dydx17493m25rh59j2sf2525r49htr2cva5rqnf76r7/.test(dydx) &&
      /DYDX_BUILDER_FEE_PPM = 500/.test(dydx) && /builderAddress: DYDX_BUILDER_ADDRESS/.test(dydx));
    t('the dYdX key is memory-only and the order page is reachable',
      !/localStorage/.test(code(dydx)) && /path="\/dydx"/.test(app));
    t('the known compromised dYdX client versions are not installed',
      JSON.parse(read('package.json')).dependencies['@dydxprotocol/v4-client-js'] === '3.4.0');

    /*
     * ─── THE BUG THIS SECTION FOUND ─────────────────────────────────────────
     * `allRemainingAreCodeComplete` was `waiting.every(l => l.ready)` where
     * `waiting` is already filtered to `ready === true`. So it was vacuously
     * true and stayed true even with four unbuilt lines on the list — a
     * headline that could never go false, in the one endpoint whose job is to
     * stop exactly that kind of quiet lie.
     */
    t('the code-complete headline counts the unbuilt rows',
      /notCodeComplete = lines\.filter\(\(l\) => !l\.live && !l\.ready\)/.test(rdc) &&
      /allRemainingAreCodeComplete: notCodeComplete\.length === 0/.test(rdc));
    /*
     * And the BUILD list is narrower than that. kyberswap-key is `ready:false`
     * but its blocker is Kyber answering an email, not code — putting it on a
     * build list would misdirect in the opposite direction.
     */
    t('...but the build list excludes rows blocked on somebody else',
      /needsBuild = notCodeComplete\.filter\(\(l\) => l\.blockedBy !== 'THIRD_PARTY'\)/.test(rdc));
    t('...and cannot be the old vacuous form',
      !/allRemainingAreCodeComplete: waiting\.every/.test(rdc));
    /* Naming them, because "4 things need building" is unactionable. */
    t('...and names what still needs building',
      /needsBuild: needsBuild\.map\(\(l\) => l\.id\)/.test(rdc));

    /*
     * ─── NOTHING ON SCREEN MAY CLAIM THIS YET ───────────────────────────────
     * The Perp screen's notice already switches between "we earn nothing" and
     * "we take a share" based on venueReferral. Builder codes are a separate,
     * unbuilt mechanism and must not leak into that decision until an order
     * path exists.
     */
    t('the builder module is not wired into any screen yet',
      !/builderCodes/.test(read('src/pages/Perp.jsx')));

    /*
     * ─── OSTIUM: THE FIRST BUILDER CODE ACTUALLY ENCODED ────────────────────
     * Everything above is research. This is the transaction, and the checks
     * below guard the four things that would each earn zero — or lose a
     * user's money — while looking entirely correct on screen.
     */
    t('the Ostium module exists', existsSync('src/lib/ostium.js'));
    const ost = code(read('src/lib/ostium.js'));

    /*
     * ─── TRAP 1: THE ALLOWANCE GOES SOMEWHERE ELSE ──────────────────────────
     * We call Trading (0x6D0b…) but collateral is pulled by TradingStorage
     * (0xccd5…). Approving the contract we call is the obvious, reasonable,
     * completely broken choice — every trade would revert on transferFrom.
     * Pinned to both literals so they cannot be "tidied" into one address.
     */
    t('the Trading contract address is pinned',
      /OSTIUM_TRADING = '0x6D0bA1f9996DBD8885827e1b2e8f6593e7702411'/.test(ost));
    t('...and the USDC spender is TradingStorage, not the contract we call',
      /OSTIUM_SPENDER = '0xcCd5891083A8acD2074690F65d3024E7D13d66E7'/.test(ost));
    t('...and the approval really uses the spender, not the callee',
      /encodeFunctionData\('approve', \[\s*OSTIUM_SPENDER,/.test(ost));

    /*
     * ─── TRAP 2: THE TENTH STRUCT MEMBER ────────────────────────────────────
     * Ostium's developer page documents nine fields ending at `buy`. The
     * deployed contract has ten. Omitting `isDayTrade` changes the selector,
     * so the transaction does not merely misbehave — it fails to decode.
     * Also pins slippageP as uint256; the older docs imply a small int.
     */
    t('the trade struct carries isDayTrade, which the docs omit',
      /bool buy,bool isDayTrade\) t/.test(ost));
    t('...and slippageP is uint256 as the contract declares',
      /uint8 orderType,uint256 slippageP\)/.test(ost));

    /*
     * ─── TRAP 3: THE FACTOR-OF-100 FEE ──────────────────────────────────────
     * builderFee is a PERCENT scaled by 1e6, so 5 bps is 50000 — verified
     * against the SDK's own encoding. A slip here charges 5% instead of 0.05%.
     */
    t('the builder fee is scaled the way the contract wants',
      /return Math\.round\(n \* 10_000\);/.test(ost));

    /*
     * ─── TRAP 4: A CAP THAT DID NOT CAP ─────────────────────────────────────
     * `ostiumFeeBps` shipped for an hour as `Math.min(n, venueCap)` with a
     * comment claiming our 10 bps limit won. It did not — Ostium's 50 did, so
     * any direct caller could charge ten times our intended rate. Assert the
     * MIN OF BOTH, and separately that the old one-sided form is gone.
     */
    t('the fee is clamped by our cap and the venue\u2019s, not just theirs',
      /Math\.min\(BUILDER_BPS_MAX, BUILDER_VENUES\.ostium\.capBps\)/.test(ost));
    t('...and the old one-sided clamp cannot come back',
      !/Math\.min\(n, venueCap\)/.test(ost));

    /*
     * The SDK is deliberately NOT a dependency: 177KB gzipped against a 237KB
     * entry bundle. If it ever appears in package.json this decision has been
     * silently reversed and the bundle has nearly doubled.
     */
    const pkg = JSON.parse(read('package.json'));
    t('the 177KB Ostium SDK is not shipped to the browser',
      !pkg.dependencies?.['@ostium/builder-sdk'] && !/@ostium\/builder-sdk/.test(ost));

    /*
     * This module must never submit. It returns unsigned calldata and the
     * wallet layer signs, exactly like aggregator.js. A sendTransaction here
     * would be a module that can move money on its own.
     */
    t('the Ostium module cannot submit a transaction by itself',
      !/sendTransaction/.test(ost));

    /* Below Ostium's own minimum the contract rejects, and letting someone
       sign a doomed transaction costs them gas for nothing. */
    t('trades below the venue minimum are refused before signing',
      /MIN_COLLATERAL_USD = 5/.test(ost) && /return 'BELOW_MIN'/.test(ost));
    /* Null, not a partial sum, when the venue's own fee is unknown — a total
       that omits a component reads as cheaper than the trade really is. */
    t('an unknown venue fee produces no total rather than a wrong one',
      /totalFee: venueFee == null \? null :/.test(ost));

    /* The encoder and the wallet-signed order screen are now both wired. */
    t('readiness reports the Ostium encoder as built',
      /id: 'builder-ostium',[\s\S]{0,200}?ready: true/.test(rdc));
    t('...and the order path as live',
      /id: 'builder-ostium',[\s\S]{0,160}?live: true/.test(rdc));
    t('the Ostium page signs the encoder output with the user wallet',
      existsSync('src/pages/Ostium.jsx') &&
      /buildOpenTrade/.test(read('src/pages/Ostium.jsx')) &&
      /signer\.sendTransaction/.test(read('src/pages/Ostium.jsx')));

    /* The Ostium build report, and the two facts in it that must not rot. */
    t('the Ostium build is written up', existsSync('docs/OSTIUM-BUILDER-FA.md'));
    const odoc = read('docs/OSTIUM-BUILDER-FA.md');
    t('...it says the encoder was verified against their SDK',
      /بایت‌به‌بایت/.test(odoc));
    /* The historical report now points readers to the completed next step. */
    t('...and records the completed trading screen',
      /صفحهٔ معامله ساخته شد/.test(odoc));

    /* The Persian write-up, which is the actual deliverable for this question. */
    t('the CCXT answer is written up', existsSync('docs/CCXT-BUILDER-CODES-FA.md'));
    const doc = read('docs/CCXT-BUILDER-CODES-FA.md');
    /*
     * The two conclusions that must survive editing: CCXT's own route needs
     * the user's API key on our server, and builder codes are 25x the
     * referral. Matched on the claim, not on one phrasing of it.
     */
    t('...it says why the CCXT broker route needs the user\u2019s API key',
      /کلید API/.test(doc) && /غیرکاستدیال/.test(doc));
    t('...and carries the 25x arithmetic',
      /۲۵ برابر/.test(doc));
  }

  /* ------------------- stocks venue tabs and CORS proxies ------------------ */
  {
    const stocks = read('src/pages/Stocks.jsx');
    const appSrc = read('server/app.js');
    const dydxClient = read('src/lib/dydx.js');
    const ostiumClient = read('src/lib/ostium.js');
    const vite = read('vite.config.js');
    const sw = read('public/sw.js');

    const perp = read('src/pages/Perp.jsx');
    const bothPages = stocks + perp;
    t('Stocks exposes the three venue tabs',
      bothPages.includes("'ostium'") && bothPages.includes("'derivatives'"));
    t('venue tabs lazy-load their pages',
      /lazyRetry\(\(\) => import\('\.\/Ostium'\)\)/.test(bothPages) &&
      /lazyRetry\(\(\) => import\('\.\/Dydx'\)\)/.test(bothPages) &&
      /lazyRetry\(\(\) => import\('\.\/DerivativesDashboard'\)\)/.test(bothPages));

    t('dYdX exposes all three same-origin public routes',
      /app\.get\('\/api\/dydx\/markets'/.test(appSrc) &&
      /app\.get\('\/api\/dydx\/orderbook\/:ticker'/.test(appSrc) &&
      /app\.get\('\/api\/dydx\/account\/:address\/:number'/.test(appSrc));
    t('dYdX browser reads use the same-origin API',
      /API_BASE.*\/api/.test(dydxClient) &&
      /API_BASE}\/dydx\/markets/.test(dydxClient) &&
      /API_BASE}\/dydx\/orderbook/.test(dydxClient) &&
      /API_BASE}\/dydx\/account/.test(dydxClient) &&
      !/DYDX_INDEXER}\/v4\//.test(dydxClient));

    t('Ostium exposes same-origin prices and subgraph routes',
      /app\.get\('\/api\/ostium\/prices'/.test(appSrc) &&
      /app\.post\('\/api\/ostium\/subgraph'/.test(appSrc));
    t('Ostium browser reads use the proxy rather than CORS upstream',
      /API_BASE}\/ostium\/prices/.test(ostiumClient) &&
      /API_BASE}\/ostium\/subgraph/.test(ostiumClient) &&
      !/fetch\(`\$\{OSTIUM_API\}/.test(ostiumClient));

    t('dYdX proxy has a browser https-proxy-agent shim',
      existsSync('src/shims/https-proxy-agent.js') &&
      /https-proxy-agent/.test(vite) &&
      /src\/shims\/https-proxy-agent\.js/.test(vite) &&
      /class HttpsProxyAgent/.test(read('src/shims/https-proxy-agent.js')));
    t('the service-worker shell cache moved to v3',
      /fbt-shell-v3/.test(sw) && !/fbt-shell-v2/.test(sw));
  }

  /* ---- 102. the wallet glow layer must not push the panel down ---------- */
  /*
   * REAL BUG: `.wal-hero > *` gives every direct child `position: relative`
   * so the content can stack above the decorative layers. The exception list
   * spelled the glow layer's class with a dash (`wal-hero-aurora`) while the
   * JSX actually renders `wallet-hero-aurora` (Wallet.jsx, Signals.jsx).
   *
   * Because `.wal-hero > *` has higher specificity than the glow's own
   * `position: absolute` rule, the exception never matched: the light layer
   * was forced in-flow as a real ~280px block, and a big empty bar appeared
   * above the address, pushing the whole panel's content down.
   *
   * So: every aurora class actually used in the JSX must appear in that
   * rule's `:not()` list, or the glow will take up space again.
   */
  {
    const css = read('src/index.css');
    const rule = css.match(/\.wal-hero\s*>\s*\*[^}]*}/)?.[0] ?? '';

    const used = new Set();
    for (const f of files) {
      for (const m of read(f).matchAll(/className="([^"]*)"/g)) {
        for (const c of m[1].split(/\s+/)) {
          // Only the wallet hero's own glow layer. Other aurora effects
          // (`aurora`, `derivatives-aurora`) are separate layers in their
          // own containers and must not be dragged into this rule.
          if (/^(wal-|wallet-)hero-aurora$/.test(c)) used.add(c);
        }
      }
    }

    const uncovered = [...used].filter((c) => !rule.includes(`:not(.${c})`));
    t(
      `the hero stacking rule excludes every aurora class used in JSX${
        uncovered.length ? ` — missing: ${uncovered.join(', ')}` : ''
      }`,
      used.size > 0 && uncovered.length === 0
    );
  }

  /* ---- 103. SOL must be swappable, and Sell must mean sell ----------------- */
  /*
   * REAL BUG: «در بازار بعضی از کویین ها میگه هنوز روی این شبکه نداری مثل
   * توکن سولنا». The curated swap table only covered EVM tokens, so SOL had
   * no market button and its coin page said "not swappable / on a network we
   * do not support" — while the app has a working Solana swap screen.
   * Second half: the Solana screen read `side=sell` and discarded it, so a
   * coin page's Sell button opened a BUY order.
   */
  {
    const c2s = read('src/lib/coinToSwap.js');
    const sol = read('src/pages/SolanaSwap.jsx');

    t('SOL resolves to a curated Solana target, offline',
      /if \(id === 'solana'\) return SOLANA_TARGET;/.test(c2s) &&
      /kind: 'solana'/.test(c2s) &&
      /\/solana\?to=\$\{encodeURIComponent\(target\.token\.symbol\)\}&side=\$\{side\}/.test(c2s));

    t('the Solana screen honours side=sell in every handoff',
      (sol.match(/searchParams\.get\('side'\) === 'sell'/g) || []).length >= 2);
  }

  /* ---- 104. Calendar rewards, earned shares, per-swap point, wallet speed --- */
  {
    const ranks = read('src/lib/ranks.js');
    const daily = read('src/lib/dailyRewards.js');
    const store = read('src/store/useAppStore.js');
    const earn = read('src/pages/Earn.jsx');
    const evmSwap = read('src/pages/Swap.jsx');
    const solSwap = read('src/pages/SolanaSwap.jsx');
    const shareHook = read('src/hooks/useShare.js');
    const shareLib = read('src/lib/share.js');
    const shareSheet = read('src/components/ShareSheet.jsx');
    const localWallet = read('src/lib/localWallet.js');
    const walletContext = read('src/context/WalletContext.jsx');
    const connectSheet = read('src/components/WalletConnectSheet.jsx');
    const walletScreen = read('src/pages/Wallet.jsx');

    t('daily claims compare local calendar dates instead of elapsed hours',
      /getFullYear\(\)/.test(daily) && /getMonth\(\)/.test(daily) && /getDate\(\)/.test(daily));
    t('the store is the only daily-claim mutation path used by Earn',
      /dailyRewardStatus/.test(store) && /claimDailyReward\(Date\.now\(\)\)/.test(earn) &&
      !/useAppStore\.setState\(\{ lastClaim/.test(earn));
    t('the old rolling 20-hour daily rule is gone',
      !/20\s*\*\s*3600000/.test(store) && !/20\s*\*\s*3600000/.test(earn));

    t('the repeatable swap reward is exactly one point', /swap:\s*1\b/.test(ranks));
    t('both accepted EVM success paths award the repeatable swap point',
      (evmSwap.match(/awardPoints\('swap',\s*POINT_VALUES\.swap/g) || []).length === 2);
    t('a successful Solana submission awards the same repeatable point',
      /if \(signature\) \{[\s\S]*?awardPoints\('swap', POINT_VALUES\.swap/.test(solSwap));

    const awaitShare = earn.indexOf('const result = await share(');
    const shareAward = earn.indexOf("awardPoints('shareApp'", awaitShare);
    t('share points are awarded only after awaiting a successful share result',
      awaitShare >= 0 && shareAward > awaitShare && /if \(!result\?\.ok\) return;/.test(earn));
    t('sharing no longer pays or completes an unverified referral',
      !/awardPoints\('referral'/.test(earn) && !/completeQuest\('inviteFriend'/.test(earn));
    t('fallback share promises resolve only on a choice/copy or dismissal',
      /new Promise\(\(resolve\)/.test(shareHook) && /onShared: \(result\) => finishFallback/.test(shareHook) &&
      /onShared\?\.\(\{ ok: true, via: 'copy' \}\)/.test(shareSheet));
    t('opening Telegram compose is not misreported as a completed share',
      !/\.openTelegramLink\(/.test(shareLib) && !/via: 'telegram'/.test(shareLib));

    t('vault creation returns its already-derived memory-only signer',
      /createVaultWithSigner/.test(localWallet) && /signer: provider \? wallet\.connect\(provider\) : wallet/.test(localWallet));
    t('new-wallet onboarding attaches that signer without decrypting again',
      /createVaultWithSigner\(phrase, password\)/.test(connectSheet) &&
      /attachCreatedLocal\(signer\)/.test(connectSheet) &&
      !/createVault\(phrase, password\)[\s\S]{0,100}unlockLocal/.test(connectSheet));
    t('the created signer is verified against the persisted vault before attach',
      /signerAddress\.toLowerCase\(\) !== vault\.address\.toLowerCase\(\)/.test(walletContext));
    t('the wallet crypto chunk is preloaded while onboarding is open',
      /if \(open\) void preloadWalletCrypto\(\)/.test(connectSheet));

    t('the practice stocks banner is a semantic localized button',
      /className="wallet-stocks-banner"/.test(walletScreen) &&
      /t\('wallet\.stocksBanner\.title'\)/.test(walletScreen) &&
      !/سهام واقعی|Real Stocks/.test(walletScreen));
    for (const lang of ['en', 'fa', 'ar', 'es', 'fr', 'hi', 'id', 'pt', 'ru', 'tr', 'ur', 'zh']) {
      const locale = JSON.parse(read(`src/i18n/locales/${lang}.json`));
      t(`${lang} localizes every stocks-banner string`,
        ['eyebrow', 'title', 'description', 'cta', 'aria']
          .every((key) => String(locale.wallet?.stocksBanner?.[key] || '').trim().length > 0));
    }
  }

  /* ---- 105. Localized Auto Orders + source-aware market intelligence ------ */
  {
    const orders = read('src/pages/Orders.jsx');
    const newsPage = read('src/pages/News.jsx');
    const panel = read('src/components/MarketInsightsPanel.jsx');
    const marketApi = read('src/lib/api.js');
    const insights = read('src/lib/marketInsights.js');
    const insightSession = read('src/lib/insightSession.js');
    const marketProviders = read('server/providers.js');
    const solanaAssetsServer = read('server/solanaAssets.js');
    const header = read('src/components/Header.jsx');
    const newsLib = read('src/lib/news.js');
    const css = read('src/index.css');

    t('News places market intelligence immediately after Radio and before Calm',
      (/\['read', 'whales', 'community', 'listen', 'insights', 'calm'\]/.test(newsPage) ||
       /\['read', 'community', 'listen', 'insights', 'calm'\]/.test(newsPage)) &&
      /tab === 'insights'[\s\S]*?<MarketInsightsPanel/.test(newsPage));
    t('News keeps one feed request while the global header only reuses its cache',
      (newsPage.match(/getNews\(/g) || []).length === 1 &&
      !/getNews\(/.test(header) &&
      /cachedHeadlines\(\)/.test(header) &&
      /export function cachedHeadlines\(\)/.test(newsLib));

    t('insight rankings reject absent and non-finite 24-hour values',
      /typeof value !== 'number'/.test(insights) && /typeof value !== 'string'/.test(insights) &&
      /String\(value\)\.trim\(\) !== ''/.test(insights) &&
      /Number\.isFinite\(Number\(value\)\)/.test(insights));
    t('the verified-equity server preserves an absent 24-hour move as null',
      /function finiteOrNull\(value\)/.test(solanaAssetsServer) &&
      /change24h:\s*finiteOrNull\(live\.stats24h\?\.priceChange\)/.test(solanaAssetsServer) &&
      !/change24h:\s*Number\([^\n]+\)\s*\|\|\s*0/.test(solanaAssetsServer));
    t('generated offline market rows carry provenance and cannot enter intelligence rankings',
      /withProvenance\(offlineMarkets\(perPage\), 'offline'\)/.test(marketApi) &&
      /withProvenance\([\s\S]*?'live'/.test(marketApi) &&
      /dataProvenance === 'offline'/.test(insights) &&
      /insights\.marketUnavailable/.test(panel));
    t('missing crypto moves stay null through both live normalization paths',
      (marketApi.match(/change24h:[^\n]+\?\? null/g) || []).length >= 2 &&
      (marketProviders.match(/change24h:[^\n]+\?\? null/g) || []).length >= 2);
    t('generated digests and ordinary price stories are filtered out of events',
      /item\?\.digest/.test(insights) && /EVENT_TERMS/.test(insights) &&
      /sourceCat === 'events'/.test(insights));
    t('unsupported flow and accounting metrics remain explicit source gaps',
      /NO_VERIFIED_COUNTRY_FLOW_SOURCE/.test(insights) &&
      /NO_ACCOUNTING_PROFIT_SOURCE/.test(insights) &&
      /NO_VERIFIED_FLOW_SOURCE/.test(insights) &&
      /insights\.countryUnavailable/.test(panel) &&
      /insights\.profitUnavailable/.test(panel) &&
      /insights\.outflowUnavailable/.test(panel));
    t('verified equity rows are session-only and never put in persistent storage',
      /useSyncExternalStore/.test(insightSession) &&
      !/(localStorage|sessionStorage)\.(getItem|setItem)|indexedDB\.(open|deleteDatabase)/.test(insightSession));
    t('the lazy equity request ignores results after the panel unmounts',
      /let cancelled = false/.test(panel) &&
      (panel.match(/if \(cancelled\) return/g) || []).length >= 2 &&
      /return \(\) => \{ cancelled = true; \}/.test(panel));

    const stageCss = css.match(/\.header-brand-stage\s*\{[^}]*}/)?.[0] ?? '';
    const layerCss = css.match(/\.header-brand-layer,\s*\.header-spotlight-layer\s*\{[^}]*}/)?.[0] ?? '';
    t('brand and spotlight share one clipped fixed-height header stage',
      /header-brand-stage[\s\S]*header-brand-layer[\s\S]*header-spotlight-layer/.test(header) &&
      /position:\s*relative/.test(stageCss) && /height:\s*34px/.test(stageCss) &&
      /overflow:\s*hidden/.test(stageCss) && /contain:\s*layout paint/.test(stageCss) &&
      /position:\s*absolute/.test(layerCss) && /inset:\s*0/.test(layerCss));
    t('header timing returns to the brand between one-minute insight cards',
      /BRAND_MS = 2 \* 60 \* 1000/.test(header) &&
      /SPOTLIGHT_MS = 60 \* 1000/.test(header) &&
      /showSpotlight \? SPOTLIGHT_MS : BRAND_MS/.test(header));
    t('header market polling is slow and does not add a news network request',
      /3 \* 60 \* 1000/.test(header) && !/getNews/.test(header));
    t('reduced-motion users keep a static brand with no spotlight transition',
      /<BrandMark still=\{still\}/.test(header) &&
      /animate=\{still \? \{ rotateY: 0 \}/.test(header) &&
      /prefers-reduced-motion:\s*reduce[\s\S]*?header-brand-layer[\s\S]*?transition:\s*none/.test(css));
    t('insight images decode asynchronously and fail back to lightweight icons',
      /decoding="async"/.test(panel) && /onError=\{\(event\) => \{ event\.currentTarget\.hidden = true; \}\}/.test(panel) &&
      /decoding="async"/.test(header) && /IconClock/.test(header) && /IconBuilding/.test(header));

    const ordersCode = orders
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    t('all Auto Orders creation cards and sheet titles come from translations',
      ['limit', 'trailing', 'bracket', 'ladder', 'dca', 'twap', 'rebalance']
        .every((kind) => ordersCode.includes(`t('orders.type.${kind}')`)) &&
      /t\(`orders\.new\.\$\{kind\}`\)/.test(ordersCode) &&
      !/[\u0600-\u06ff]/.test(ordersCode));

    const orderKeys = [
      'title', 'subtitle', 'bannerTitle', 'bannerSub',
      'newLimit', 'newTrailing', 'newBracket', 'newLadder', 'newDca', 'newTwap', 'newRebalance',
      'type.limit', 'type.trailing', 'type.bracket', 'type.ladder', 'type.dca', 'type.twap', 'type.rebalance',
      'new.limit', 'new.trailing', 'new.bracket', 'new.ladder', 'new.dca', 'new.twap', 'new.rebalance'
    ];
    const insightKeys = [
      'news.tab.insights', 'insights.title', 'insights.cryptoLeader', 'insights.cryptoLaggard',
      'insights.tokenizedLeader', 'insights.companyLeader', 'insights.countryFlow',
      'insights.companyProfit', 'insights.capitalOutflow', 'insights.eventsTitle',
      'insights.unavailable', 'insights.marketUnavailable', 'insights.disclaimer', 'insights.header.leader',
      'insights.header.laggard', 'insights.header.company', 'insights.header.event'
    ];
    const valueAt = (root, path) => path.split('.').reduce((value, key) => value?.[key], root);
    for (const lang of ['en', 'fa', 'ar', 'es', 'fr', 'hi', 'id', 'pt', 'ru', 'tr', 'ur', 'zh']) {
      const locale = JSON.parse(read(`src/i18n/locales/${lang}.json`));
      t(`${lang} localizes the visible Auto Orders and market-insight surfaces`,
        [...orderKeys.map((key) => `orders.${key}`), ...insightKeys]
          .every((key) => String(valueAt(locale, key) || '').trim().length > 0));
    }
  }

  /* ---------------- signed solver commitments + transparency log -------- */
  {
    const serverApp = read('server/app.js');
    const signatures = read('server/intentSignatures.js');
    const transparency = read('server/intentTransparency.js');
    const auctions = read('server/intentAuctions.js');
    const anchors = read('server/intentAnchors.js');
    const anchorContract = read('contracts/IntentAuctionAnchor.sol');
    const intentPage = read('src/pages/IntentOS.jsx');
    const envExample = read('.env.example');

    t('signed commitment submission and public solver/log discovery are all wired',
      /\/api\/intents\/v1\/solvers/.test(serverApp) &&
      /\/api\/intents\/v1\/commitments/.test(serverApp) &&
      /\/api\/intents\/v1\/log\/:intentHash/.test(serverApp) &&
      /appendSignedCommitment/.test(serverApp));
    t('solver admission uses server-only Ed25519 public keys',
      /INTENT_SOLVER_KEYS/.test(signatures) && /Ed25519/.test(signatures) &&
      /INTENT_SOLVER_KEYS=/.test(envExample) && !/VITE_INTENT_SOLVER/.test(envExample));
    t('financial transparency entries never use the mutable board store',
      /allowOverwrite:\s*false/.test(transparency) &&
      !/from ['"]\.\/store\.js['"]/.test(transparency) &&
      /NONCE_REPLAY/.test(transparency));
    t('network status honestly exposes solver count, durability and external-anchor state',
      /registeredSolvers/.test(transparency) && /persistenceMode/.test(transparency) &&
      /externallyAnchored:\s*false/.test(transparency) &&
      /getIntentCapabilities/.test(intentPage) && /transparency\?\.durable/.test(intentPage) &&
      /transparency\?\.externallyAnchored/.test(intentPage));
    t('auction close is authenticated, coordinator-signed and exposed through public state',
      /authenticateAuctionClose/.test(serverApp) && /\/auctions\/:intentHash\/close/.test(serverApp) &&
      /signCanonicalPayload/.test(auctions) && /verifyAuctionClose/.test(auctions) &&
      /AUCTION_CLOSED/.test(serverApp));
    t('auction selection and capability claims explicitly refuse completeness and fund authority',
      /MAX_OUTPUT_WITHIN_SIGNED_LIMITS_V1/.test(auctions) &&
      /auctionCompletenessProven:\s*false/.test(auctions) &&
      /userFundsAuthorised:\s*false/.test(auctions) &&
      /crossInstanceTransactionalClose:\s*false/.test(auctions));
    t('external anchor evidence is accepted only from a verified configured-contract EVM event',
      /eth_getTransactionReceipt/.test(anchors) && /AuctionRootAnchored/.test(anchors) &&
      /ANCHOR_EVENT_MISMATCH/.test(anchors) && /verifyAnchorClaim/.test(serverApp));
    t('the anchor contract is permissionless evidence and cannot hold or execute user funds',
      /contract IntentAuctionAnchor/.test(anchorContract) && /mapping\(bytes32 anchorKey => bool\)/.test(anchorContract) &&
      /keccak256\(abi\.encode\(closeId, intentHash, logRoot, logSize, closedAt\)\)/.test(anchorContract) &&
      !/(IERC20|transferFrom|delegatecall|selfdestruct)/.test(anchorContract));
    t('auction coordinator and anchor RPC secrets stay server-only',
      /INTENT_COORDINATOR_PRIVATE_KEY=/.test(envExample) && /INTENT_AUCTION_CLOSE_TOKEN=/.test(envExample) &&
      /INTENT_ANCHOR_NETWORKS=/.test(envExample) && !/VITE_INTENT_(COORDINATOR|ANCHOR)/.test(envExample));
    t('Intent OS reports close, anchor-network and completeness status',
      /auctions\?\.closeConfigured/.test(intentPage) && /configuredAnchorNetworks/.test(intentPage) &&
      /auctionCompletenessProof/.test(intentPage));
  }

  /* ---------------- confidential intent fail-closed boundary ------------- */
  {
    const appCode = read('server/app.js');
    const commitments = read('server/intentCommitment.js');
    const confidential = read('server/intentConfidential.js');
    const capabilities = read('server/intents.js');
    const swap = read('src/pages/Swap.jsx');
    const intentPage = read('src/pages/IntentOS.jsx');
    const compiler = read('src/lib/intentOS.js');
    const network = read('src/lib/intentNetwork.js');
    const enLocale = JSON.parse(read('src/i18n/locales/en.json'));

    const parserIndex = appCode.indexOf("app.use(express.json({ limit: '256kb' }))");
    const commitRouteIndex = appCode.indexOf("app.post('/api/intents/v1/confidential/commit'");
    const revealRouteIndex = appCode.indexOf("app.post('/api/intents/v1/confidential/reveal'");
    t('disabled confidential writes are mounted before global body parsing',
      commitRouteIndex > 0 && revealRouteIndex > 0
        && commitRouteIndex < parserIndex && revealRouteIndex < parserIndex);
    t('the browser client exposes discovery only and no confidential write fallback',
      /getConfidentialIntentStatus/.test(network)
        && !/(post|request)Confidential(Intent)?(Commit|Reveal)/.test(network)
        && !/method:\s*['"]POST['"]/.test(network));
    t('Swap preserves the exact confidential URL requirement while consuming only prefill keys',
      /isConfidentialPrivacy\(searchParams\)/.test(swap)
        && /new URLSearchParams\(searchParams\)/.test(swap)
        && /for \(const key of \['from', 'to', 'amount', 'chain'\]\) next\.delete\(key\)/.test(swap)
        && !/delete\(['"]privacy['"]\)/.test(swap));
    t('Swap blocks quote, gasless, approval and execution paths for confidential handoffs',
      /if \(confidentialRequested\) \{[\s\S]{0,220}quoteSeq\.current \+= 1/.test(swap)
        && /const retryQuote = \(\) => \{\s*if \(confidentialRequested\) return;/.test(swap)
        && /const runGasless = async \(\) => \{\s*if \(confidentialRequested\)/.test(swap)
        && /const runSwap = async \(\) => \{\s*if \(confidentialRequested\)/.test(swap)
        && /const canSwap = !confidentialRequested/.test(swap)
        && /const gaslessOk = !confidentialRequested/.test(swap));
    t('Intent OS confidential selection is single-swap and capability driven',
      /draft\.kind === ['"]swap['"] && confidentialReadiness\.available/.test(intentPage)
        && /disabled=\{disabled\}/.test(intentPage)
        && /confidentialAvailable: confidentialSelectable/.test(intentPage)
        && /runtime\.confidentialAvailable === true/.test(compiler));
    t('commitment storage separates and authenticates records but has no insecure production adapter',
      /privateRecord/.test(commitments)
        && /publicCommitmentRecord/.test(commitments)
        && /verifyIntentCommitment/.test(commitments)
        && /UNAUTHENTICATED_REQUESTER/.test(commitments)
        && /COMMITMENT_REPLAY/.test(commitments)
        && /CONFIDENTIAL_PRIVATE_STORE_UNAVAILABLE/.test(commitments)
        && !/blobCache/.test(commitments));
    t('capabilities and English UI deny plaintext, metadata, threshold, TEE and attestation claims',
      /confidentialAvailable:\s*false/.test(capabilities)
        && /thresholdEncryption:\s*\{[\s\S]*configured:\s*false/.test(confidential)
        && /hiddenFromFbt:\s*false/.test(confidential)
        && /metadataPrivacy:\s*false/.test(confidential)
        && /tee:\s*false/.test(confidential)
        && /attestation:\s*false/.test(confidential)
        && /does not hide plaintext from FBT/i.test(enLocale.intentOS.privacy.confidential.body)
        && /no metadata privacy/i.test(enLocale.intentOS.privacy.confidential.body));
  }

  return rows;
}
