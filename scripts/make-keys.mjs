#!/usr/bin/env node
/**
 * GENERATE THE PUSH SECRETS — locally, on your own machine.
 *
 *   node scripts/make-keys.mjs
 *
 * Produces VAPID_PRIVATE_KEY, VITE_VAPID_PUBLIC_KEY and CRON_SECRET.
 *
 * WHY NOT A WEBSITE
 *
 * Plenty of sites offer to "generate VAPID keys for you". Never use one. The
 * private key is what proves a push message came from your server; whoever
 * holds it can send a notification to every user of your app, from your
 * origin, with your name on it. A site that generates it has, by definition,
 * seen it. This script uses Node's built-in crypto and touches no network —
 * you can read all of it in a minute and verify that claim.
 *
 * WHAT THESE ARE
 *
 *   VAPID keypair  An ECDSA P-256 pair. The PUBLIC half is compiled into the
 *                  browser bundle (that is what VITE_ means) and is meant to
 *                  be public. The PRIVATE half is server-only and must never
 *                  carry a VITE_ prefix, or it ships to every user.
 *
 *   CRON_SECRET    A shared password on /api/cron/daily. Without it, anyone
 *                  who finds the URL can make your app notify all users, as
 *                  often as they like.
 *
 * These are unrelated to the Android signing keystore. Losing these is
 * recoverable: generate new ones, update the env vars, and existing
 * subscribers re-register on next open.
 */

import crypto from 'node:crypto';

const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/**
 * Web Push (RFC 8292) wants the public key as the 65-byte uncompressed EC
 * point (0x04 ‖ X ‖ Y), base64url encoded — not the SPKI wrapper Node exports
 * by default. The raw point is the last 65 bytes of the DER, and it always
 * starts with 0x04. Get this wrong and every subscribe() call fails with an
 * opaque InvalidAccessError in the browser.
 */
function vapidKeys() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1' // a.k.a. P-256 / secp256r1
  });

  const raw = publicKey.export({ type: 'spki', format: 'der' }).subarray(-65);
  if (raw[0] !== 0x04 || raw.length !== 65) {
    throw new Error('unexpected EC point encoding — refusing to emit a bad key');
  }

  const jwk = privateKey.export({ format: 'jwk' });

  const pub = b64url(raw);
  const priv = jwk.d; // already base64url in a JWK

  // Fail loudly rather than handing over a key that will not work.
  if (pub.length !== 87) throw new Error(`public key is ${pub.length} chars, expected 87`);
  if (priv.length !== 43) throw new Error(`private key is ${priv.length} chars, expected 43`);

  return { pub, priv };
}

const { pub, priv } = vapidKeys();
const cron = crypto.randomBytes(24).toString('base64url');

const line = '─'.repeat(64);

console.log(`
${line}
  FBT Swap — push secrets
${line}

Paste each of these into Vercel:
  Project → Settings → Environment Variables

Set every one to: Production, Preview AND Development.

${line}
  1. VITE_VAPID_PUBLIC_KEY      (public — safe in the browser bundle)
${line}
${pub}

${line}
  2. VAPID_PRIVATE_KEY          (SECRET — server only, no VITE_ prefix)
${line}
${priv}

${line}
  3. CRON_SECRET                (SECRET — protects /api/cron/daily)
${line}
${cron}

${line}

WARNINGS

  • Never add a VITE_ prefix to numbers 2 or 3. Anything starting with
    VITE_ is compiled into the JavaScript every user downloads, so a
    "secret" with that prefix is published, not stored.

  • Do not paste 2 or 3 into a chat, screenshot, issue or commit. If you
    ever do, run this script again and replace both — treat them as burnt.

  • After saving, REDEPLOY. Vercel bakes environment variables in at build
    time; an existing deployment keeps the old values and will look like
    the change did nothing.

  • Verify with:  https://<your-app>.vercel.app/api/cron/status
    It reports which variables are still missing, and never their values.
`);
