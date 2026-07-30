/**
 * FIREBASE CLOUD MESSAGING (HTTP v1)
 * ---------------------------------------------------------------------------
 * A second delivery channel alongside VAPID web push (server/push.js).
 *
 * WHY BOTH, AND WHEN EACH ONE WINS
 *
 * VAPID web push is the open standard and needs no Google account. It works in
 * any browser and in the installed PWA. But in a Capacitor Android build the
 * page runs in a WebView, and a WebView has no Push API at all — so a user who
 * installs the APK from Play gets no web push, ever. FCM is the channel that
 * reaches those users.
 *
 * So: web/PWA/Telegram → VAPID. Installed Android app → FCM. `broadcastAll`
 * in push.js fans out to whichever channels are configured, and a device
 * registered on both is de-duplicated by the shared `tag`.
 *
 * ─── SECURITY: WHY THIS FILE READS A SERVICE ACCOUNT ─────────────────────────
 * FCM HTTP v1 requires an OAuth2 token minted from a service-account key. That
 * key is FULL ADMIN on the Firebase project: it can read and delete every
 * database record and impersonate any user. It is not a "notification key".
 *
 * Rules this file enforces:
 *   1. The key is read from the environment only. Never from a file in the
 *      repo, and there is no fallback path that could accidentally pick up a
 *      committed serviceAccountKey.json.
 *   2. It is server-only. There is no VITE_ prefix anywhere here, so it can
 *      never be inlined into the browser bundle.
 *   3. Only the `firebase.messaging` scope is requested. Even if the token
 *      leaks, it cannot touch Firestore or Auth.
 *   4. Failures are logged without ever echoing the key material.
 *
 * If the key is ever pasted somewhere public, deleting it in the Google Cloud
 * console is the ONLY fix — it cannot be rotated by changing a password.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import crypto from 'node:crypto';
import { readFcmTokens, removeFcmToken } from './store.js';

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || '';
const CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL || '';

/**
 * The private key arrives from a dashboard env var, where a real newline
 * cannot usually be typed — so it is stored with literal "\n" sequences.
 * Converting them back is the single most common reason FCM setup fails with
 * an opaque "invalid_grant".
 */
const PRIVATE_KEY = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

export const fcmConfigured = () =>
  Boolean(PROJECT_ID && CLIENT_EMAIL && PRIVATE_KEY.includes('BEGIN PRIVATE KEY'));

/* -------------------------------------------------------------------------- */
/* OAuth2         
/* -------------------------------------------------------------------------- */

let cachedToken = null; // { token, exp }

const b64url = (input) =>
  Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/**
 * Mint an access token by signing a JWT with the service-account key.
 *
 * Implemented with node:crypto rather than pulling in firebase-admin: that
 * package is ~50 MB of dependencies for what is, at bottom, one signed JWT and
 * one HTTPS POST. Fewer dependencies is also fewer places a supply-chain
 * compromise could read this key.
 */
async function accessToken() {
  // Reuse while valid, with a 60s safety margin against clock skew.
  if (cachedToken && cachedToken.exp - 60_000 > Date.now()) return cachedToken.token;

  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(
    JSON.stringify({
      iss: CLIENT_EMAIL,
      // Narrow scope on purpose: messaging only, never datastore or identity.
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600
    })
  );

  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${header}.${claim}`);
  const signature = signer.sign(PRIVATE_KEY, 'base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claim}.${signature}`
    })
  });

  if (!res.ok) {
    // Deliberately does not include the response body verbatim in case it
    // ever echoes part of the assertion.
    throw new Error(`FCM_AUTH_FAILED_${res.status}`);
  }

  const data = await res.json();
  cachedToken = { token: data.access_token, exp: Date.now() + data.expires_in * 1000 };
  return cachedToken.token;
}

/* -------------------------------------------------------------------------- */
/* Send                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Send one notification to every registered FCM token.
 *
 * @param {(lang:string) => {title:string, body:string, url?:string}} build
 *        Called per token so each device is messaged in the language it
 *        registered with. The OS notification shade renders this text
 *        directly — the app never gets a chance to translate it.
 */
export async function fcmBroadcast(build, { tag = 'fbt-daily' } = {}) {
  if (!fcmConfigured()) return { sent: 0, failed: 0, skipped: 'NOT_CONFIGURED' };

  const tokens = await readFcmTokens();
  if (!tokens.length) return { sent: 0, failed: 0 };

  let token;
  try {
    token = await accessToken();
  } catch (e) {
    return { sent: 0, failed: tokens.length, error: e.message };
  }

  const url = `https://fcm.googleapis.com/v1/projects/${PROJECT_ID}/messages:send`;
  let sent = 0;
  let failed = 0;
  const dead = [];

  // Sequential with a small concurrency window. FCM rate-limits per project,
  // and a burst of hundreds of parallel requests gets throttled as a whole
  // rather than queued.
  const CHUNK = 10;
  for (let i = 0; i < tokens.length; i += CHUNK) {
    const slice = tokens.slice(i, i + CHUNK);
    await Promise.all(
      slice.map(async (row) => {
        const msg = build(row.lang || 'en');
        try {
          const res = await fetch(url, {
            method: 'POST',
            headers: {
              authorization: `Bearer ${token}`,
              'content-type': 'application/json'
            },
            body: JSON.stringify({
              message: {
                token: row.token,
                notification: { title: msg.title, body: msg.body },
                data: { url: msg.url || '/', tag },
                android: {
                  priority: 'normal',
                  notification: { tag, icon: 'ic_launcher', color: '#7c4dff' }
                }
              }
            })
          });

          if (res.ok) {
            sent += 1;
            return;
          }

          /*
           * UNREGISTERED / INVALID_ARGUMENT mean the token is permanently
           * dead: the app was uninstalled or the token was rotated. Pruning
           * immediately matters — dead tokens otherwise accumulate forever and
           * every future send burns a request on an endpoint that can never
           * deliver.
           */
          if (res.status === 404 || res.status === 400) dead.push(row.token);
          failed += 1;
        } catch {
          failed += 1;
        }
      })
    );
  }

  for (const t of dead) await removeFcmToken(t);
  return { sent, failed, pruned: dead.length };
}
