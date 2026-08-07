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
    '/solana'                   // -> tab inside /swap
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
     * Open by default, unlike the others. Someone who believes a tokenised
     * share IS a share has misunderstood what they own, and that
     * misunderstanding survives until it costs them.
     */
    t('...and opens by default, because the misunderstanding is costly',
      /stocks-before[\s\S]{0,40}defaultOpen|defaultOpen[\s\S]{0,40}stocks-before/.test(stocks));
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
      t('...and renders it behind a third tab',
        /'read', 'listen', 'calm'/.test(code(read('src/pages/News.jsx'))) &&
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
      /setTokenSym\(e\.target\.value\);[\s\S]{0,80}setAmount\(''\)/.test(send));

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
     * And the screen must not draw an analysis of a coin it cannot identify:
     * with no coin there is no volume, no market cap and no name, so the
     * panel would render a confident read of an unknown asset.
     */
    t('the coin page waits for the coin before rendering its analysis',
      /const analysisReady = Boolean\(coin\) && analysis/.test(code(read('src/pages/CoinDetail.jsx'))));

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
  }

  return rows;
}
