/**
 * Firebase — anonymous auth + settings sync. Optional and lazy-loaded.
 *
 * ─── WHY THERE IS NO SERVICE-ACCOUNT KEY HERE ─────────────────────────────
 * A Firebase *service account* private key grants full admin access to the
 * whole project: read/write every document, mint tokens for any user, bypass
 * all security rules. It belongs on a server, in a secrets manager — never in
 * a client bundle, a repo, or a chat message.
 *
 * What the browser uses instead is the *web app config* (apiKey, projectId,
 * appId). Those are public identifiers by design — Firebase expects them to
 * ship in your JS. Access is controlled by Firestore Security Rules, not by
 * hiding the config. Rules to apply in the console:
 *
 *   rules_version = '2';
 *   service cloud.firestore {
 *     match /databases/{database}/documents {
 *       match /users/{uid} {
 *         allow read, write: if request.auth != null && request.auth.uid == uid;
 *       }
 *     }
 *   }
 *
 * Without those rules your database is world-writable regardless of any key.
 *
 * WHAT WE SYNC: theme, accent, username, and display preferences. Never the
 * seed phrase, never the wallet password, never the 2FA secret. Those stay
 * encrypted on the device — putting them in a cloud database would hand an
 * attacker who breaches Firebase the keys to every user's funds.
 * ──────────────────────────────────────────────────────────────────────────
 */

const config = {
  apiKey: import.meta.env?.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env?.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env?.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env?.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env?.VITE_FIREBASE_SENDER_ID,
  appId: import.meta.env?.VITE_FIREBASE_APP_ID
};

export const firebaseConfigured = Boolean(config.apiKey && config.projectId && config.appId);

let cached = null;

/** Lazily boot Firebase. Returns null when it isn't configured. */
async function getFirebase() {
  if (!firebaseConfigured) return null;
  if (cached) return cached;

  const [{ initializeApp, getApps }, authMod, storeMod] = await Promise.all([
    import('firebase/app'),
    import('firebase/auth'),
    import('firebase/firestore')
  ]);

  const app = getApps().length ? getApps()[0] : initializeApp(config);
  const auth = authMod.getAuth(app);
  const db = storeMod.getFirestore(app);

  cached = { app, auth, db, authMod, storeMod };
  return cached;
}

/**
 * Anonymous sign-in: gives a stable uid for syncing without asking anyone to
 * hand over an email. On a DEX, requiring identity to change a theme colour
 * would be a real privacy regression.
 */
export async function ensureAnonUser() {
  const fb = await getFirebase();
  if (!fb) return null;
  const { auth, authMod } = fb;
  if (auth.currentUser) return auth.currentUser;
  try {
    const cred = await authMod.signInAnonymously(auth);
    return cred.user;
  } catch (e) {
    console.warn('[firebase] anonymous auth failed:', e.code ?? e.message);
    return null;
  }
}

export async function pushSettings(payload) {
  const fb = await getFirebase();
  if (!fb) return false;
  const user = await ensureAnonUser();
  if (!user) return false;
  try {
    const { storeMod, db } = fb;
    await storeMod.setDoc(
      storeMod.doc(db, 'users', user.uid),
      { settings: payload, updatedAt: storeMod.serverTimestamp() },
      { merge: true }
    );
    return true;
  } catch (e) {
    console.warn('[firebase] push failed:', e.code ?? e.message);
    return false;
  }
}

export async function pullSettings() {
  const fb = await getFirebase();
  if (!fb) return null;
  const user = await ensureAnonUser();
  if (!user) return null;
  try {
    const { storeMod, db } = fb;
    const snap = await storeMod.getDoc(storeMod.doc(db, 'users', user.uid));
    return snap.exists() ? snap.data().settings ?? null : null;
  } catch (e) {
    console.warn('[firebase] pull failed:', e.code ?? e.message);
    return null;
  }
}

export async function currentUid() {
  const fb = await getFirebase();
  return fb?.auth?.currentUser?.uid ?? null;
}

/** Analytics is opt-in and never blocks rendering. */
export async function logAppEvent(name, params = {}) {
  if (!firebaseConfigured) return;
  try {
    const fb = await getFirebase();
    const { getAnalytics, isSupported, logEvent } = await import('firebase/analytics');
    if (!(await isSupported())) return;
    logEvent(getAnalytics(fb.app), name, params);
  } catch {
    /* analytics must never break the app */
  }
}
