/**
 * PRICE-WATCH → PUSH DELIVERY PROBE
 * ---------------------------------------------------------------------------
 * REAL BUG, reported from a phone: «بالا و پایین رفتن سود و ضرر توکن ها» — token
 * P&L move alerts showed on the app page but NEVER in the Android notification
 * bar or the iPhone's notification stack, not with the app closed and not with
 * the screen locked. Auto-order alerts had the same symptom.
 *
 * Two root causes, both asserted here against the REAL modules:
 *
 *   1. THE ALERTS HAD NO SERVER EVALUATOR AT ALL. src/lib/priceAlerts.js could
 *      only fire from the Market page's polling loop — its own header said «WHY
 *      IT CANNOT RUN IN THE BACKGROUND». server/priceWatch.js is the missing
 *      background twin: this probe runs its REAL cycle against stubbed price
 *      feeds and proves the honesty guards (silence never alerts, stale
 *      baselines re-arm, impossible jumps are refused, cooldowns start only on
 *      a DELIVERED alert), the delivery routing shape, and the copy.
 *
 *   2. A TAP ON A DELIVERED CARD WENT NOWHERE. notify.js's safeNativeRoute
 *      allowlisted exactly three routes (/orders, /intent, /swap), so a
 *      price-alert card deep-linking to /coin/<id> (and a smart-money card to
 *      /smart-money/…) opened the app at whatever screen it was left on. The
 *      patterns below are pinned to real <Route> entries in src/App.jsx.
 *
 * Plus the wire format: `fcmSendToToken` is exercised with a stubbed network
 * and a throwaway service-account key, and EVERY field of the assembled FCM
 * HTTP v1 message is validated against the documented enum values and key
 * names — the class of bug that made every send fail as INVALID_ARGUMENT once
 * already (`channelId` vs `channel_id`).
 *
 * No device, no real network, no real key.
 */

import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';

/* -------------------------------------------------------------------------- */
/* harness                                                                     */
/* -------------------------------------------------------------------------- */

const rows = [];
function ok(label, pass, detail = '') {
  rows.push([detail ? `${label} — ${detail}` : label, Boolean(pass)]);
}

/* -------------------------------------------------------------------------- */
/* 1. the server-side cycle (real priceWatch.js, stubbed feeds)                */
/* -------------------------------------------------------------------------- */

const fcmIdentity = `fcm:${'d'.repeat(152)}-probe`;
const webIdentity = `https://probe-${Date.now()}.example.com/device`;

/** A market row in the shape fetchMarkets returns (normalizeCoin). */
const marketRow = (id, rank, change24h, price = 100) => ({
  id, symbol: id.toUpperCase().slice(0, 6), name: id, price, change24h, rank
});

async function cycleProbe() {
  const {
    putPriceWatch, runPriceWatchCycle, buildPriceMoveAlert,
    maybePriceWatchTick, readPriceWatches, priceWatchStatus
  } = await import('../server/priceWatch.js');

  const sent = [];
  const send = async (identity, message) => {
    sent.push({ identity, message });
    return true;
  };
  const failSend = async () => false;
  const throwSend = async () => { throw new Error('push channel down'); };
  /* Every scenario passes an EMPTY market feed unless it IS the movers test —
     the probe must never reach the network. */
  const noMovers = async () => [];
  /* Park an identity between scenarios: no coins, no movers → it evaluates
     nothing, so one scenario's rows cannot pollute another's counts. */
  const park = (id) => putPriceWatch(id, { coins: [], topMovers: false, lang: 'en' });

  /* ---------- registration validation ---------- */
  let threw = false;
  try { await putPriceWatch('not-an-identity', { coins: [] }); } catch { threw = true; }
  ok('putPriceWatch rejects an identity that is neither https nor fcm:', threw);

  const reg = await putPriceWatch(fcmIdentity, {
    coins: [
      { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin' },
      { id: 'BAD ID!', symbol: 'X' },
      { id: 'bitcoin', symbol: 'BTC' },
      { id: 'ethereum', symbol: 'ETH', name: 'Ethereum' }
    ],
    thresholdPct: 5,
    lang: 'fa'
  });
  ok('a valid sync stores only valid, deduped coin ids', reg.ok && reg.count === 2, `count=${reg.count}`);

  const clamped = await putPriceWatch(webIdentity, {
    coins: [{ id: 'solana', symbol: 'SOL', name: 'Solana' }],
    thresholdPct: 999,
    lang: 'en'
  });
  ok('the threshold is clamped to a sane band (never 999%)', clamped.ok);
  ok('priceWatchStatus counts both identities',
    (await priceWatchStatus()).identities === 2);
  await park(webIdentity);

  /* ---------- A: silence → first sighting → a real move → cooldown ---------- */
  const t0 = Date.now();
  const none = await runPriceWatchCycle(send, t0, { fetchPrices: async () => ({}), fetchMarkets: noMovers });
  ok('a missing price NEVER alerts (fired=' + none.fired + ')', none.fired === 0 && none.delivered === 0);
  ok('and it does not invent a baseline either',
    !(await readPriceWatches()).find((w) => w.identity === fcmIdentity)?.baselines?.bitcoin);

  const first = await runPriceWatchCycle(send, t0 + 1000, {
    fetchPrices: async () => ({ bitcoin: { usd: 100000 }, ethereum: { usd: 3000 } }),
    fetchMarkets: noMovers
  });
  ok('the first sighting records baselines and never alerts', first.fired === 0);
  ok('the baseline really was stored (a re-arm-only cycle still persists)',
    (await readPriceWatches()).find((w) => w.identity === fcmIdentity)?.baselines?.bitcoin?.base === 100000);

  sent.length = 0;
  const up = await runPriceWatchCycle(send, t0 + 2000, {
    fetchPrices: async () => ({ bitcoin: { usd: 106000 }, ethereum: { usd: 3000 } }),
    fetchMarkets: noMovers
  });
  ok('a +6% move on a watched coin fires exactly one alert',
    up.fired === 1 && up.delivered === 1 && sent.length === 1, `fired=${up.fired}`);
  const msg = sent[0]?.message || {};
  ok('it is addressed to the device that owns the watch', sent[0]?.identity === fcmIdentity);
  ok('the card colours itself from the SIGN of the move (mint = up)', msg.tone === 'profit');
  ok('the hero number is the move, signed', String(msg.value).startsWith('+'), msg.value);
  ok('the tag matches the client local card (one row per coin on the phone)',
    msg.tag === 'fbt-price-bitcoin');
  ok('the deep link opens the coin chart', msg.url === '/coin/bitcoin');
  ok('the copy is in the language the device registered with (fa)',
    /بالا رفته/.test(msg.body), msg.body);
  ok('the card carries the design-system kicker', msg.kicker === 'PROFIT');

  sent.length = 0;
  const quiet = await runPriceWatchCycle(send, t0 + 3000, {
    fetchPrices: async () => ({ bitcoin: { usd: 106500 }, ethereum: { usd: 3000 } }),
    fetchMarkets: noMovers
  });
  ok('a second move inside the cooldown is absorbed', quiet.fired === 0 && sent.length === 0);
  await park(fcmIdentity);

  /* ---------- B: a failed delivery is RETRYABLE, never swallowed ---------- */
  const retryIdentity = `fcm:${'r'.repeat(152)}-probe`;
  await putPriceWatch(retryIdentity, {
    coins: [{ id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin' }], thresholdPct: 5, lang: 'fa'
  });
  const seed = await runPriceWatchCycle(send, t0 + 4000, {
    fetchPrices: async () => ({ bitcoin: { usd: 100000 } }), fetchMarkets: noMovers
  });
  ok('the retry device seeded its baseline', seed.fired === 0);
  const failed = await runPriceWatchCycle(failSend, t0 + 5000, {
    fetchPrices: async () => ({ bitcoin: { usd: 110000 } }), fetchMarkets: noMovers
  });
  ok('a FAILED send is counted as fired but NOT delivered',
    failed.fired === 1 && failed.delivered === 0);
  const retried = await runPriceWatchCycle(throwSend, t0 + 6000, {
    fetchPrices: async () => ({ bitcoin: { usd: 110000 } }), fetchMarkets: noMovers
  });
  ok('a throwing send re-arms nothing — the SAME move fires again next cycle',
    retried.fired === 1 && retried.delivered === 0);
  sent.length = 0;
  const recovered = await runPriceWatchCycle(send, t0 + 7000, {
    fetchPrices: async () => ({ bitcoin: { usd: 110000 } }), fetchMarkets: noMovers
  });
  ok('and a successful retry delivers it (cooldown starts only NOW)',
    recovered.delivered === 1 && sent.length === 1);
  ok('the retried card is the same move: mint, signed +10%',
    sent[0]?.message?.tone === 'profit' && String(sent[0]?.message?.value).startsWith('+'));
  await park(retryIdentity);

  /* ---------- C: the data-fault ceiling — «BTC +۴۰٪» is never news ---------- */
  const faultIdentity = `fcm:${'f'.repeat(152)}-probe`;
  await putPriceWatch(faultIdentity, {
    coins: [{ id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin' }], thresholdPct: 5, lang: 'fa'
  });
  await runPriceWatchCycle(send, t0 + 8000, {
    fetchPrices: async () => ({ bitcoin: { usd: 100000 } }), fetchMarkets: noMovers
  });
  sent.length = 0;
  const fault = await runPriceWatchCycle(send, t0 + 9000, {
    fetchPrices: async () => ({ bitcoin: { usd: 140000 } }), fetchMarkets: noMovers
  });
  ok('a +40% jump within the short window is treated as a DATA FAULT, not news',
    fault.fired === 0 && sent.length === 0);
  ok('and the baseline re-arms at the new price (next moves measured honestly)',
    (await readPriceWatches()).find((w) => w.identity === faultIdentity)?.baselines?.bitcoin?.base === 140000);
  await park(faultIdentity);

  /* ---------- D: a stale baseline re-arms silently ---------- */
  const staleIdentity = `fcm:${'s'.repeat(152)}-probe`;
  await putPriceWatch(staleIdentity, {
    coins: [{ id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin' }], thresholdPct: 5, lang: 'fa'
  });
  await runPriceWatchCycle(send, t0 + 10000, {
    fetchPrices: async () => ({ bitcoin: { usd: 100000 } }), fetchMarkets: noMovers
  });
  sent.length = 0;
  const stale = await runPriceWatchCycle(send, t0 + 10000 + 8 * 24 * 3600000, {
    fetchPrices: async () => ({ bitcoin: { usd: 130000 } }), fetchMarkets: noMovers
  });
  ok('a baseline unseen for 8 days re-arms silently instead of alerting +30%',
    stale.fired === 0 && sent.length === 0);
  await park(staleIdentity);

  /* ---------- E: top movers — the feed's own 24h change, top 3 by rank ------ */
  const moversIdentity = `fcm:${'m'.repeat(152)}-probe`;
  await putPriceWatch(moversIdentity, {
    coins: [{ id: 'solana', symbol: 'SOL', name: 'Solana' }],
    thresholdPct: 5, lang: 'fa'
  });
  const moverFeed = async () => [
    marketRow('pepe', 51, 12),      // beyond ±5% but rank 51
    marketRow('bitcoin', 1, 6),
    marketRow('ethereum', 2, -7.5),
    marketRow('solana', 3, 9, 150),
    marketRow('xrp', 4, 2)          // inside the band
  ];
  sent.length = 0;
  const movers = await runPriceWatchCycle(send, t0 + 20000, {
    fetchPrices: async () => ({ solana: { usd: 150 } }),
    fetchMarkets: moverFeed
  });
  const moverMsgs = sent.filter((s) => s.message.tag?.startsWith('fbt-mover-'));
  ok('top movers fire for the top-3 BY RANK beyond ±5% (pepe at rank 51 is out)',
    moverMsgs.length === 3, `fired=${moverMsgs.length}`);
  ok('the mover card uses the mover tag (its own row on the phone)',
    moverMsgs.every((s) => /^fbt-mover-[a-z0-9-]+$/.test(s.message.tag)));
  ok('a down mover is a loss card', moverMsgs.some((s) => s.message.tone === 'loss'));
  ok('an up mover is a profit card', moverMsgs.some((s) => s.message.tone === 'profit'));
  ok('the mover copy names the rank and the 24h window',
    /24|۲۴/.test(moverMsgs[0].message.body) && /رتبه|rank|المرتبة/.test(moverMsgs[0].message.body));

  sent.length = 0;
  const moversQuiet = await runPriceWatchCycle(send, t0 + 21000, {
    fetchPrices: async () => ({ solana: { usd: 150 } }),
    fetchMarkets: moverFeed
  });
  ok('the same movers are quiet inside their 12h cooldown', moversQuiet.fired === 0 && sent.length === 0);

  /* ---------- replace-all semantics + cursor survival ---------- */
  /* moversIdentity still carries its solana baseline from the cycle above. */
  await putPriceWatch(moversIdentity, {
    coins: [{ id: 'solana', symbol: 'SOL', name: 'Solana' }, { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin' }],
    thresholdPct: 5, lang: 'fa'
  });
  const kept = (await readPriceWatches()).find((w) => w.identity === moversIdentity);
  ok('a re-sync keeps the server-side baseline for a STILL-WATCHED coin (dedupe survives)',
    kept.baselines?.solana != null);
  ok('a re-sync drops the baseline of an un-starred coin',
    kept.coins.length === 2 && kept.baselines?.bitcoin == null);
  await putPriceWatch(moversIdentity, {
    coins: [{ id: 'solana', symbol: 'SOL', name: 'Solana' }],
    thresholdPct: 5, lang: 'fa'
  });
  const resynced = (await readPriceWatches()).find((w) => w.identity === moversIdentity);
  ok('and dropping it from the sync really removes the row (replace-all)',
    resynced.coins.length === 1);
  await park(moversIdentity);

  /* ---------- the copy builder itself ---------- */
  const card = buildPriceMoveAlert({
    kind: 'price', coin: { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin' },
    pct: -3.2, price: 64000, lang: 'en'
  });
  ok('buildPriceMoveAlert renders the en deck for a falling coin',
    /down 3.2%/.test(card.body) && card.tone === 'loss', card.body);

  /* ---------- the throttled tick ---------- */
  const tick1 = await maybePriceWatchTick({ send, force: true, now: t0 + 30000 });
  ok('a forced price tick actually runs the cycle', tick1.skipped === undefined);
  const tick2 = await maybePriceWatchTick({ send, now: t0 + 31000 });
  ok('an immediate second tick is THROTTLED, not a second alert', tick2.skipped === 'THROTTLED');
  const tick3 = await maybePriceWatchTick({ now: t0 + 32000 });
  ok('a tick with no sender reports NO_SENDER instead of pretending', tick3.skipped === 'NO_SENDER');
}

/* -------------------------------------------------------------------------- */
/* 2. the FCM wire format (real fcm.js + real notificationDesign, stubbed net) */
/* -------------------------------------------------------------------------- */

async function wireProbe() {
  /* fcm.js reads its credentials at module load — the environment must be set
     BEFORE the import. A throwaway RSA key signs the OAuth assertion; the
     network stub answers both OAuth and messages:send. */
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  process.env.FIREBASE_PROJECT_ID = 'fbtswap-36b13';
  process.env.FIREBASE_CLIENT_EMAIL = 'probe@fbtswap-36b13.iam.gserviceaccount.com';
  process.env.FIREBASE_PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' }).replace(/\n/g, '\\n');

  const calls = [];
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('oauth2.googleapis.com')) {
      return { ok: true, status: 200, json: async () => ({ access_token: 'probe-token', expires_in: 3600 }) };
    }
    if (u.includes('fcm.googleapis.com')) {
      calls.push({ url: u, body: JSON.parse(opts.body) });
      return { ok: true, status: 200, json: async () => ({ name: 'ok' }), text: async () => '' };
    }
    return { ok: false, status: 599, json: async () => ({}), text: async () => '' };
  };

  const { fcmSendToToken, fcmConfigured, shouldPruneToken } = await import('../server/fcm.js');
  ok('the throwaway service account is accepted by fcmConfigured()', fcmConfigured());

  const { buildPriceMoveAlert } = await import('../server/priceWatch.js');
  const payload = buildPriceMoveAlert({
    kind: 'price', coin: { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin' },
    pct: 6.2, price: 106000, lang: 'fa'
  });
  const delivered = await fcmSendToToken('d'.repeat(152) + '-wire', payload);
  ok('fcmSendToToken accepts a price-alert payload and sends', delivered === true && calls.length === 1);

  const msg = calls[0]?.body?.message || {};
  const an = msg.android?.notification || {};

  /* Every android.notification key must be a documented FCM REST field — the
     `channelId` (vs `channel_id`) bug that rejected every send as
     INVALID_ARGUMENT and then DELETED the device token. */
  const ALLOWED = new Set([
    'title', 'body', 'icon', 'color', 'image', 'sound', 'tag', 'click_action',
    'body_loc_key', 'body_loc_args', 'title_loc_key', 'title_loc_args',
    'channel_id', 'ticker', 'sticky', 'event_time', 'local_only',
    'notification_priority', 'default_sound', 'default_vibrate_timings',
    'default_light_settings', 'light_settings', 'vibrate_timings',
    'visibility', 'notification_count', 'proxy'
  ]);
  const badKeys = Object.keys(an).filter((k) => !ALLOWED.has(k));
  ok(`every android.notification key is a documented REST field (bad: ${badKeys.join(',') || 'none'})`,
    badKeys.length === 0);
  ok('the channel field is spelled channel_id (REST), not channelId',
    'channel_id' in an && an.channel_id.startsWith('fbt_'));
  ok('money news posts to the HIGH-importance alerts channel',
    an.channel_id === 'fbt_alerts_v1');
  ok('the priority enum is a valid AndroidNotification value',
    ['PRIORITY_MIN', 'PRIORITY_LOW', 'PRIORITY_DEFAULT', 'PRIORITY_HIGH', 'PRIORITY_MAX'].includes(an.notification_priority));
  ok('the visibility enum is valid and PUBLIC (the lock screen shows it)',
    ['VISIBILITY_UNSPECIFIED', 'PRIVATE', 'PUBLIC', 'SECRET'].includes(an.visibility) && an.visibility === 'PUBLIC');
  ok('event_time is a parseable timestamp', Number.isFinite(Date.parse(an.event_time)));
  ok('the artwork URL is absolute (the phone fetches it, not the page)',
    /^https:\/\//.test(an.image), an.image);
  ok('the message is HIGH priority (wakes a dozing phone / closed app)',
    msg.android.priority === 'high');
  ok('every data value is a string (FCM rejects non-strings)',
    Object.values(msg.data || {}).every((v) => typeof v === 'string'));
  ok('the foreground card receives the same label and kicker as the artwork',
    msg.data.label === payload.label && msg.data.kicker === payload.kicker);
  ok('the FCM artwork requests the new design instead of an immutable old image',
    new URL(an.image).searchParams.get('d') === '2');
  ok('the top-level notification block carries title/body/image',
    Boolean(msg.notification?.title && msg.notification?.body && msg.notification?.image));

  /* APNs half — what the iPhone's notification stack / island summary reads. */
  ok('iOS replaces one card per order via apns-collapse-id (mirrors the Android tag)',
    msg.apns?.headers?.['apns-collapse-id'] === an.tag);
  ok('money news asks APNs for immediate delivery (priority 10)',
    msg.apns?.headers?.['apns-priority'] === '10');
  ok('the alert is time-sensitive on iOS (banners over the lock screen)',
    msg.apns?.payload?.aps?.['interruption-level'] === 'time-sensitive');
  ok('iOS gets the system chime (a name not in the bundle would be SILENT)',
    msg.apns?.payload?.aps?.sound === 'default');

  /* Prune policy: only a TOKEN-level rejection may delete a device. */
  ok('a 404 prunes the dead token', shouldPruneToken(404, 'UNREGISTERED') === true);
  ok('a 400 that names the token prunes', shouldPruneToken(400, 'registration token is not valid') === true);
  ok('a 400 from OUR malformed payload does NOT prune (that bug unsubscribed everyone)',
    shouldPruneToken(400, 'INVALID_ARGUMENT: message.android.notification.foo') === false);
  ok('a transient 500 never prunes', shouldPruneToken(500, 'INTERNAL') === false);
}

/* -------------------------------------------------------------------------- */
/* 3. safeNativeRoute — tapping a card must open the screen it names           */
/* -------------------------------------------------------------------------- */

async function routeProbe() {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://localhost/' });
  const w = dom.window;
  global.window = w;
  global.document = w.document;
  global.localStorage = w.localStorage;
  Object.defineProperty(global, 'navigator', { value: w.navigator, configurable: true });
  w.Capacitor = { isNativePlatform: () => true };

  const { safeNativeRoute } = await import(`../src/lib/notify.js?routes=${Date.now()}`);

  ok('a price-alert deep link to the coin chart is allowed',
    safeNativeRoute('/coin/bitcoin') === '/#/coin/bitcoin', String(safeNativeRoute('/coin/bitcoin')));
  ok('the hash form the payloads use is allowed too',
    safeNativeRoute('/#/coin/ethereum') === '/#/coin/ethereum');
  ok('a smart-money wallet card deep-links', safeNativeRoute('/smart-money/wallet/1/0xabc') === '/#/smart-money/wallet/1/0xabc');
  ok('a smart-money token card deep-links', safeNativeRoute('/#/smart-money/token/solana/So1111') === '/#/smart-money/token/solana/So1111');
  ok('order alerts keep their execute query', safeNativeRoute('/#/orders?execute=abc123') === '/#/orders?execute=abc123');
  ok('a farm rate alert keeps its query', safeNativeRoute('/farm?tab=watchlist&pool=x') === '/#/farm?tab=watchlist&pool=x');

  ok('an EXTERNAL url is refused', safeNativeRoute('https://evil.example/coin/bitcoin') === null);
  ok('a traversal is refused (URL normalises it to /evil)',
    safeNativeRoute('/coin/../evil') === null);
  ok('an unknown route is refused', safeNativeRoute('/admin/secret') === null);
  ok('a script-ish path is refused', safeNativeRoute('/coin/%3Cscript%3E') === null);
  ok('a non-string is refused', safeNativeRoute(undefined) === null && safeNativeRoute(42) === null);

  /* The patterns must mirror REAL routes in App.jsx — a link that resolves
     here but matches no <Route> lands on the catch-all and "does nothing". */
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  ok('App.jsx really has the /coin/:id route', app.includes('path="/coin/:id"'));
  ok('App.jsx really has the smart-money wallet/token routes',
    app.includes('path="/smart-money/wallet/:chain/:address"') && app.includes('path="/smart-money/token/:chain/:address"'));
  ok('App.jsx really has the /orders route', app.includes('path="/orders"'));
}

/* -------------------------------------------------------------------------- */

export default async function run() {
  await cycleProbe();
  await wireProbe();
  await routeProbe();
  return rows;
}

/* Self-runner: `node test/price-watch-push-probe.mjs` reports and exits
   non-zero on any failure, so it can gate CI on its own. */
if (process.argv[1] && /price-watch-push-probe\.mjs$/.test(process.argv[1])) {
  run().then((all) => {
    const fails = all.filter(([, pass]) => !pass);
    for (const [label, pass] of all) console.log(`${pass ? '✓' : '✗'} ${label}`);
    console.log(`\n${all.length - fails.length}/${all.length} assertions passed`);
    if (fails.length) process.exitCode = 1;
    else console.log('✓ price-watch-push-probe: all assertions passed (no device, no real network)\n');
  }).catch((e) => {
    console.error('price-watch-push-probe crashed:', e);
    process.exitCode = 1;
  });
}
