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

/**
 * Which project is actually configured, and does each part look sane?
 *
 * ─── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * The owner has to rotate a leaked service-account key from a phone, and
 * `fcmConfigured()` answers only true/false. When it says false there are
 * three candidate causes and no way to tell them apart without reading logs
 * he cannot reach.
 *
 * Worse, writing the rotation guide turned up a real ambiguity: this repo
 * names TWO Firebase projects. `.env.example` carries `fbt-cryp` for the
 * browser SDK, while every server-side doc says `fbt-room-a46fc`. Those may
 * legitimately be two projects, or one of them may be stale — but if the new
 * key is created under the wrong one, FCM breaks with an opaque `invalid_grant`
 * and the guide would be blamed before the project id was.
 *
 * So this echoes the project id being used. That is safe: a Firebase project
 * id is public by construction — it appears in the client bundle already, in
 * VITE_FIREBASE_PROJECT_ID. The private key is NEVER echoed, only described.
 */
export function fcmDiagnose() {
  return {
    configured: fcmConfigured(),
    /* Public identifier, already shipped in the browser bundle. */
    projectId: PROJECT_ID || null,
    clientEmailSet: Boolean(CLIENT_EMAIL),
    /*
     * The three failure modes of the private key, reported separately because
     * the fix for each is different:
     *
     *   present=false  -> the variable was not saved, or not redeployed
     *   looksPem=false -> the BEGIN/END wrapper was trimmed off in copying
     *   hasNewlines=false -> the \n sequences were stripped or pre-converted,
     *                        which is the single most common mistake and the
     *                        one that produces the misleading `invalid_grant`
     */
    privateKey: {
      present: PRIVATE_KEY.length > 0,
      looksPem: PRIVATE_KEY.includes('BEGIN PRIVATE KEY')
        && PRIVATE_KEY.includes('END PRIVATE KEY'),
      hasNewlines: PRIVATE_KEY.includes('\n')
    }
  };
}

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
/* Live self-test                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Prove that FCM can ACTUALLY send, not merely that the variables look right.
 *
 * ─── WHY fcmDiagnose() IS NOT ENOUGH ────────────────────────────────────────
 * That function inspects the SHAPE of the credentials: is the key present,
 * does it have a PEM wrapper, does it contain newlines. Every one of those can
 * be true for a key that Google rejects — a revoked key, a key from a
 * different project, or a service account whose messaging permission was
 * removed all look identical to it. After the package rename that gap
 * mattered: the app id changed, and "the variables are still set" is not
 * evidence that push works.
 *
 * This asks GOOGLE. It mints a real OAuth token with the real key, then makes
 * a real call to the real project's messages:send endpoint using the reserved
 * invalid token literal. A 400 INVALID_ARGUMENT is the SUCCESS case here: it
 * means authentication passed, the project was found, and only the fake device
 * token was rejected. Nothing is delivered to anybody.
 *
 * @returns {Promise<{ok:boolean, stage:string, detail?:string, projectId:string|null}>}
 */
export async function fcmSelfTest() {
  if (!fcmConfigured()) {
    return { ok: false, stage: 'CONFIG', detail: 'credentials missing', projectId: PROJECT_ID || null };
  }

  let token;
  try {
    token = await accessToken();
  } catch (e) {
    /*
     * The most common real failure, and the one whose native error message is
     * least helpful: invalid_grant, which almost always means the \n escapes
     * in the private key were flattened when it was pasted.
     */
    return {
      ok: false,
      stage: 'AUTH',
      detail: String(e?.message || e).slice(0, 80),
      projectId: PROJECT_ID
    };
  }

  try {
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${PROJECT_ID}/messages:send`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      /*
       * Google document this exact string as a token that is always invalid,
       * so it can never reach a real device however the project is configured.
       */
      body: JSON.stringify({ validate_only: true, message: { token: 'SELF_TEST_INVALID_TOKEN' } })
    });

    if (res.status === 400) {
      /* Auth and project both fine; only the deliberately-fake token failed. */
      return { ok: true, stage: 'SEND', detail: 'auth ok, project reachable', projectId: PROJECT_ID };
    }
    if (res.status === 401 || res.status === 403) {
      return { ok: false, stage: 'PERMISSION', detail: `HTTP ${res.status}`, projectId: PROJECT_ID };
    }
    if (res.status === 404) {
      return { ok: false, stage: 'PROJECT', detail: 'project not found', projectId: PROJECT_ID };
    }
    return { ok: true, stage: 'SEND', detail: `HTTP ${res.status}`, projectId: PROJECT_ID };
  } catch (e) {
    return { ok: false, stage: 'NETWORK', detail: String(e?.message || e).slice(0, 80), projectId: PROJECT_ID };
  }
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
/**
 * Send to ONE device token.
 *
 * The counterpart to push.js's sendToEndpoint. Order alerts are addressed to a
 * single person — broadcasting one would be both spam and a disclosure of that
 * user's trading intent to everyone else.
 */
export async function fcmSendToToken(deviceToken, payload) {
  if (!fcmConfigured()) return false;

  let token;
  try {
    token = await accessToken();
  } catch {
    return false;
  }

  try {
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${PROJECT_ID}/messages:send`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        message: {
          token: deviceToken,
          notification: { title: payload.title, body: payload.body },
          data: { url: payload.url || '/', tag: payload.tag || 'fbt' },
          android: {
            // High priority: a price alert is time-sensitive, and normal
            // priority lets Android hold it until the next maintenance window,
            // by which point the price has moved.
            priority: 'high',
            ttl: '3600s',
            notification: { tag: payload.tag || 'fbt', icon: 'ic_launcher', color: '#7c4dff' }
          }
        }
      })
    });

    if (res.ok) return true;
    // Dead token: pruning keeps future cycles from paying for it forever.
    if (res.status === 404 || res.status === 400) await removeFcmToken(deviceToken).catch(() => {});
    return false;
  } catch {
    return false;
  }
}

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
