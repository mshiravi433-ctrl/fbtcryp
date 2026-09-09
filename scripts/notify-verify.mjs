#!/usr/bin/env node
/**
 * NOTIFICATION CHAIN VERIFIER — web push (site) + FCM (Android app)
 * ---------------------------------------------------------------------------
 * One-shot diagnostics against a deployed FBT instance. It only reads public
 * status endpoints; it never needs a key, never sends to a device and never
 * triggers a broadcast. Run it from your own machine (this sandbox has no
 * route to the public internet, so you must run it where the site is reachable).
 *
 *   BASE_URL=https://fbtswap.ir node scripts/notify-verify.mjs
 *   BASE_URL=https://fbtcryp-kkxi.vercel.app node scripts/notify-verify.mjs
 *   # include a CRON_SECRET to also test the manual re-run guard:
 *   CRON_SECRET=… node scripts/notify-verify.mjs
 *
 * What each check proves:
 *   web.configured     -> the VAPID public/private keys are present on the
 *                         server, i.e. the SITE can push to browsers/PWA.
 *   fcm.configured     -> FIREBASE_* (service-account) are present, i.e. the
 *                         ANDROID APP can push over FCM.
 *   fcmDetail          -> WHY FCM is off when it is (missing / not-PEM / no
 *                         newlines), the three failure modes of a pasted key.
 *   fcm.selftest       -> asks Google itself whether auth + project are valid
 *                         (uses a token literal that can never reach a device).
 *   durable            -> BLOB_READ_WRITE_TOKEN present, so subscriptions and
 *                         FCM tokens actually persist across cold starts.
 *   cronSecret         -> CRON_SECRET present (required to re-run the daily
 *                         cycle by hand and to gate the cron routes).
 *   live totals        -> how many web subscribers and FCM devices are stored.
 */
const BASE_URL = (process.env.BASE_URL || 'https://fbtswap.ir').replace(/\/+$/, '');

async function getJson(path, { auth } = {}) {
  const headers = { accept: 'application/json' };
  if (auth) headers.authorization = `Bearer ${auth}`;
  const res = await fetch(`${BASE_URL}${path}`, { headers });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { _raw: text.slice(0, 200) }; }
  return { status: res.status, body };
}

const ok = (b) => (b ? '✅' : '❌');

const rows = [];
const push = (name, pass, detail = '') => rows.push({ name, pass, detail });

async function main() {
  const secret = process.env.CRON_SECRET || '';

  const status = await getJson('/api/push/status');
  push('GET /api/push/status reachable', status.status === 200, `HTTP ${status.status}`);
  const s = status.body || {};
  const webReady = Boolean(s.web);
  const fcmReady = Boolean(s.fcm);
  push('SITE — VAPID web-push keys configured (web push for browsers/PWA)', webReady,
    webReady ? `subscribers=${s.subscribers}` : 'missing VITE_VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY');
  push('APP — FCM service-account configured (push for the Android APK)', fcmReady,
    fcmReady ? `devices=${s.devices}` : 'missing FIREBASE_PROJECT_ID / CLIENT_EMAIL / PRIVATE_KEY');

  const d = s.fcmDetail || {};
  push('APP — FCM project id is the real one (fbtswap-36b13)', d.projectId === 'fbtswap-36b13', `projectId=${d.projectId}`);
  if (d.privateKey && !fcmReady) {
    push('APP — private key shape', d.privateKey.looksPem && d.privateKey.hasNewlines,
      `present=${d.privateKey.present} looksPem=${d.privateKey.looksPem} hasNewlines=${d.privateKey.hasNewlines}`);
  }

  const self = await getJson('/api/push/selftest');
  push('APP — FCM self-test (asks Google, sends nothing)', self.body?.ok === true,
    self.status === 200 ? `${self.body?.stage} — ${self.body?.detail ?? ''}` : `HTTP ${self.status}`);
  if (self.body && !self.body.ok) {
    push('APP — FCM self-test failure detail', false,
      `stage=${self.body.stage} detail=${self.body.detail}`);
  }

  const cron = await getJson('/api/cron/status');
  push('GET /api/cron/status reachable', cron.status === 200, `HTTP ${cron.status}`);
  const c = cron.body || {};
  push('durable store (BLOB_READ_WRITE_TOKEN) — subscriptions persist', Boolean(c.durableStorage),
    'per-instance store forgets devices on cold start');
  push('CRON_SECRET present (manual daily-cycle re-runs work)', Boolean(c.cronSecretSet));
  if (secret) {
    const daily = await getJson('/api/cron/daily', { auth: secret });
    push('CRON_SECRET accepted (daily cycle re-run returns 200, not 401)',
      daily.status === 200,
      daily.status === 200
        ? `web=${JSON.stringify(daily.body?.web)} fcm=${JSON.stringify(daily.body?.fcm)} watch=${JSON.stringify(daily.body?.watch)}`
        : `HTTP ${daily.status} ${JSON.stringify(daily.body)}`);
  } else {
    push('CRON_SECRET accepted (daily cycle re-run)', false, 'set CRON_SECRET env to test (not required for read-only checks)');
  }

  const width = Math.max(3, ...rows.map((r) => r.name.length + 2));
  console.log(`\nFBT notification chain — ${BASE_URL}\n` + '-'.repeat(74));
  let pass = 0;
  for (const r of rows) {
    if (r.pass) pass += 1;
    console.log(`${ok(r.pass)} ${r.name.padEnd(width)} ${r.detail ? '— ' + r.detail : ''}`);
  }
  console.log('-'.repeat(74));
  console.log(`${pass}/${rows.length} checks passed\n`);

  if (pass < rows.length) {
    console.log('Summary: enable the failed items in Vercel → Settings → Environment\nVariables, then Redeploy (env is read at boot). Full guide:\ndocs/NOTIFICATIONS-LIVE-FA.md\n');
    process.exitCode = 1;
  } else {
    console.log('All green. Finish with the on-device tests in docs/NOTIFICATIONS-LIVE-FA.md (§4).\n');
  }
}

main().catch((e) => {
  console.error(`Could not reach ${BASE_URL} — run this where the site is reachable.\n${e?.message || e}`);
  process.exitCode = 1;
});
