/**
 * WALLETCONNECT VERIFY — THE DOMAIN REGISTRY, MEASURED
 * ---------------------------------------------------------------------------
 * «چرا هنوز unverified است؟» is a question about three different systems that
 * all answer with ONE label in the wallet. This module separates them, and —
 * where the answer can only come from WalletConnect's own server — it asks.
 *
 * ─── THE MECHANISM, READ FROM THE SDK (not from a blog post) ────────────────
 * `@walletconnect/core` → controllers/verify.ts:
 *
 *   1. dApp side, at propose time (sign-client/controllers/engine.ts):
 *          const attestationId = hashMessage(proposeSessionMessage);
 *          const attestation   = await core.verify.register({ id, decryptedId });
 *      `register()` appends a hidden iframe to `document.body`:
 *          https://verify.walletconnect.org/v3/attestation
 *              ?projectId=…&origin=<window.location.origin>&id=…&decryptedId=…
 *      waits up to 5s for a `postMessage` of
 *      `{ type: 'verify_attestation', attestation: <jwt> }`, and returns the
 *      JWT — or the EMPTY STRING when the iframe never answered.
 *
 *   2. wallet side, on receipt (engine.ts#getVerifyContext):
 *          resolve({ attestationId, hash, encryptedId })
 *            → ""                        ⇒ return        (verdict UNKNOWN)
 *            → payload.id !== encryptedId ⇒ return        (verdict UNKNOWN)
 *            → expired / bad signature    ⇒ return        (verdict UNKNOWN)
 *            → !payload.isVerified        ⇒ return        (verdict UNKNOWN)
 *          then: validation = (origin === new URL(metadata.url).origin)
 *                                        ? 'VALID' : 'INVALID'
 *
 *   The four states a wallet renders are therefore:
 *          VALID     «Domain match»   — attested AND in the registry AND equal
 *                                       to `metadata.url`
 *          INVALID   «Mismatch»       — attested, but metadata names another host
 *          UNKNOWN   «Cannot verify»  — no attestation at all, OR the origin is
 *                                       not in Reown's domain registry
 *          isScam    «Security risk»  — flagged by Hexagate/ChainPatrol/Hypernative
 *
 * ─── WHAT THIS MODULE ADDS ─────────────────────────────────────────────────
 * `probeVerifyAttestation()` runs step 1 exactly as the SDK does and READS the
 * JWT the server signed. That is the only place `isVerified` is visible to a
 * dApp: the wallet sees it, we never did. With it, «unverified» stops being a
 * label and becomes one of six named causes.
 *
 * `predictVerifyVerdict()` answers the same question without a browser round
 * trip, from the project's allowlist (`GET /projects/v1/origins`), which is the
 * registry the server keys `isVerified` off.
 *
 * `warmVerifyEnclave()` exists for one number: the SDK's 5-second attestation
 * budget. On a filtered network an iframe that has to resolve DNS, open TLS and
 * load its JS from scratch inside that window is the difference between
 * «Domain match» and «Cannot verify».
 *
 * Nothing here imports the SDK, and every external boundary (window, document,
 * fetch, clock) is injectable, so all of it is testable without a browser.
 */

/**
 * The Verify host the SDK trusts (`VERIFY_SERVER` / `VERIFY_SERVER_V3` in
 * `@walletconnect/core/src/constants/verify.ts`).
 */
export const VERIFY_SERVER = 'https://verify.walletconnect.org';

/** The v3 enclave base — the host `register()` builds its iframe URL from. */
export const VERIFY_SERVER_V3 = `${VERIFY_SERVER}/v3`;

/**
 * The SDK's own attestation budget: `startAbortTimer(ONE_SECOND * 5)`.
 * Matching it is deliberate — a probe that waited longer than the SDK would
 * report «reachable» on a network where every real pairing fails.
 */
export const VERIFY_ATTESTATION_TIMEOUT_MS = 5_000;

/** The dashboard a human has to click in — there is no API for it. */
export function reownDashboardUrl(projectId) {
  return `https://dashboard.reown.com/project/${String(projectId || '').trim()}`;
}

/** Strip a trailing slash and whitespace so two spellings compare equal. */
export function normalizeOrigin(value) {
  return String(value ?? '').trim().replace(/\/+$/, '');
}

/**
 * Is the origin on the project's allowlist, by the SDK's own rule?
 *
 * The rule is AppKit's (`checkAllowedOrigins`): an exact origin, a host, or a
 * scheme-less domain that covers the host (so `fbtswap.ir` covers
 * `https://fbtswap.ir` and `https://www.fbtswap.ir`). An EMPTY list means
 * AppKit allows everything — and that is true of AppKit's own gate. It is NOT
 * true of the Verify registry: a project with no domain registered cannot
 * verify any origin, and every wallet renders «Cannot verify». See
 * `predictVerifyVerdict()` — the two answers are kept separate on purpose.
 *
 * @param {string} currentOrigin
 * @param {string[]|null} list
 * @returns {boolean|null} null when there is no list to read.
 */
export function isOriginAllowed(currentOrigin, list) {
  if (!Array.isArray(list)) return null;
  if (list.length === 0) return true;
  const origin = normalizeOrigin(currentOrigin);
  if (!origin) return null;
  let host = '';
  try {
    host = new URL(origin).host;
  } catch {
    host = origin;
  }
  return list.some((entry) => {
    const e = String(entry ?? '').trim();
    if (!e) return false;
    if (e === origin || e === host) return true;
    try {
      if (new URL(e).host === host) return true;
    } catch { /* not a URL — try the bare-domain forms below */ }
    if (!e.includes('://')) {
      if (e === host.replace(/^www\./, '')) return true;
      if (host.endsWith(`.${e}`)) return true;
    }
    return false;
  });
}

/**
 * The URL `Verify.register()` builds for its hidden iframe.
 *
 * Kept as data so the panel can print the exact request a real pairing will
 * make — the QR/pairing flow can be copied out of a support thread, this
 * cannot, because it never appears anywhere in the UI.
 */
export function attestationUrl({
  projectId,
  origin,
  id,
  decryptedId,
  base = VERIFY_SERVER_V3
} = {}) {
  const url = new URL(`${normalizeOrigin(base)}/attestation`);
  url.searchParams.set('projectId', String(projectId || ''));
  url.searchParams.set('origin', String(origin || ''));
  url.searchParams.set('id', String(id || ''));
  url.searchParams.set('decryptedId', String(decryptedId || ''));
  return url.toString();
}

/** `hashMessage()`-shaped id: 0x + 64 hex, what the server expects. */
export function randomAttestationId(randomBytes) {
  const bytes = typeof randomBytes === 'function'
    ? randomBytes(32)
    : (typeof globalThis !== 'undefined' && globalThis.crypto?.getRandomValues
      ? globalThis.crypto.getRandomValues(new Uint8Array(32))
      : null);
  if (!bytes || bytes.length < 32) {
    /* No CSPRNG (an old WebView, a test): a time-seeded hex string still
       exercises the whole round trip, it just is not unpredictable — and this
       id is a diagnostic probe, never a secret. */
    let out = '';
    let seed = Date.now();
    for (let i = 0; i < 64; i += 1) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      out += (seed % 16).toString(16);
    }
    return `0x${out}`;
  }
  return `0x${[...bytes.slice(0, 32)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** Base64url → JSON, tolerant of the padding browsers accept without. */
function decodeJwtSegment(segment) {
  const padded = String(segment || '').replace(/-/g, '+').replace(/_/g, '/');
  const body = padded + '='.repeat((4 - (padded.length % 4)) % 4);
  let json;
  if (typeof globalThis !== 'undefined' && typeof globalThis.atob === 'function') {
    json = decodeURIComponent(
      [...globalThis.atob(body)].map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`).join('')
    );
  } else if (typeof Buffer !== 'undefined') {
    json = Buffer.from(body, 'base64').toString('utf8');
  } else {
    return null;
  }
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * Read the server's own answer out of the attestation JWT.
 *
 * The signature is NOT checked here, and that is a deliberate boundary: this
 * is the dApp reading the field the WALLET will read, for the purpose of
 * telling the owner «the server says your domain is not in the registry».
 * Verifying the P256 signature is the wallet's job (and would need the
 * enclave's public key, i.e. a second network round trip that can fail for
 * unrelated reasons). The claim is labelled as unverified in the payload.
 */
export function decodeAttestation(jwt) {
  const parts = String(jwt || '').split('.');
  if (parts.length < 2 || !parts[1]) return null;
  const payload = decodeJwtSegment(parts[1]);
  if (!payload || typeof payload !== 'object') return null;
  return {
    id: payload.id ?? null,
    origin: payload.origin ?? null,
    isVerified: payload.isVerified === true,
    isScam: payload.isScam === true,
    /* The SDK compares `toMiliseconds(result.exp) < Date.now()`, i.e. exp is
       in SECONDS — a probe that compared it against ms would call every
       attestation expired. */
    expiresAt: Number.isFinite(Number(payload.exp)) ? Number(payload.exp) * 1000 : null
  };
}

/**
 * Run `Verify.register()` for real and read what the server says.
 *
 * @returns {Promise<{ok:boolean, verdict:string, …}>} never throws.
 *   VERIFIED        — the server says this origin is verified, and the origin
 *                     it attested is the one `metadata.url` declares.
 *   UNVERIFIED      — the attestation arrived, but `isVerified` is false: the
 *                     origin is NOT in this project's domain registry. This is
 *                     the «unverified domain» report, named at last.
 *   MISMATCH        — verified, but for a different origin than the one asked
 *                     for (or than metadata declares) → wallet shows Mismatch.
 *   THREAT          — `isScam: true`.
 *   EXPIRED         — the JWT the server issued had already expired.
 *   ID_MISMATCH     — an attestation arrived for a different id: a replay or a
 *                     cross-tab collision. The wallet discards it too.
 *   NO_ATTESTATION  — nothing came back inside the SDK's 5s: the enclave is
 *                     blocked, filtered, or offline on THIS network.
 *   NO_BROWSER      — no document to hang an iframe on (Node, a worker).
 */
export async function probeVerifyAttestation({
  win,
  projectId,
  origin,
  id,
  decryptedId,
  timeoutMs = VERIFY_ATTESTATION_TIMEOUT_MS,
  randomBytes,
  now = () => Date.now()
} = {}) {
  const w = win ?? (typeof window !== 'undefined' ? window : null);
  const doc = w?.document;
  const startedAt = now();
  const pageOrigin = normalizeOrigin(origin || w?.location?.origin || '');
  const attestationId = id || randomAttestationId(randomBytes);
  const url = attestationUrl({
    projectId,
    origin: pageOrigin,
    id: attestationId,
    decryptedId: decryptedId || attestationId
  });
  const base = { ok: false, url, requestedId: attestationId, pageOrigin, ms: 0 };

  /* Same guard as the SDK: `isBrowser()` then `getDocument()`. A pairing booted
     from a worker or from Node can never attest, and the wallet will say
     «Cannot verify» — naming that here beats guessing it from a label. */
  if (!doc || typeof doc.createElement !== 'function' || !doc.body) {
    return { ...base, verdict: 'NO_BROWSER', error: 'NO_DOCUMENT' };
  }

  const settle = (verdict, extra = {}) => ({
    ...base,
    ...extra,
    verdict,
    ok: verdict === 'VERIFIED',
    ms: Math.max(0, now() - startedAt)
  });

  let iframe = null;
  /* An attestation for a DIFFERENT id must not end our wait — the SDK ignores
     it and so do we. It is remembered instead, because «nothing came back»
     and «something came back for another request» are different reports: the
     second one names a colliding probe or a stale tab, and no amount of
     dashboard work will change it. */
  let foreign = false;
  try {
    const jwt = await new Promise((resolve) => {
      let timer = null;
      let done = false;
      const finish = (value) => {
        if (done) return;
        done = true;
        if (timer) clearTimeout(timer);
        try {
          w.removeEventListener?.('message', listener);
        } catch { /* a fake window in a test may not implement remove */ }
        try {
          if (iframe?.parentNode) iframe.parentNode.removeChild(iframe);
        } catch { /* already detached */ }
        resolve(value);
      };
      const listener = (event) => {
        /* Same filter as the SDK: string data, the verify type. The id check
           below decides whether this message answers OUR request. */
        if (!event?.data || typeof event.data !== 'string') return;
        let data;
        try {
          data = JSON.parse(event.data);
        } catch {
          return;
        }
        if (!data || data.type !== 'verify_attestation') return;
        if (decodeAttestation(data.attestation)?.id !== attestationId) {
          foreign = true;
          return;
        }
        finish(data.attestation === null ? '' : data.attestation);
      };
      try {
        w.addEventListener?.('message', listener);
      } catch { /* nothing to listen on — the timeout below still fires */ }

      iframe = doc.createElement('iframe');
      iframe.src = url;
      iframe.style.display = 'none';
      iframe.setAttribute('aria-hidden', 'true');
      iframe.setAttribute('title', 'walletconnect-verify');
      try {
        iframe.addEventListener('error', () => finish(''), { once: true });
      } catch { /* a fake element without addEventListener — fine */ }
      try {
        doc.body.appendChild(iframe);
      } catch {
        finish('');
        return;
      }
      timer = setTimeout(() => finish(''), Math.max(500, timeoutMs));
    });

    if (!jwt) {
      return foreign
        ? settle('ID_MISMATCH', { error: 'FOREIGN_ATTESTATION' })
        : settle('NO_ATTESTATION', { error: 'NO_JWT_WITHIN_BUDGET' });
    }
    const payload = decodeAttestation(jwt);
    if (!payload) return settle('NO_ATTESTATION', { error: 'UNREADABLE_JWT' });
    if (payload.id !== attestationId) return settle('ID_MISMATCH', { attested: payload });
    if (payload.isScam) return settle('THREAT', { attested: payload });
    if (payload.expiresAt != null && payload.expiresAt < now()) return settle('EXPIRED', { attested: payload });
    if (payload.isVerified !== true) return settle('UNVERIFIED', { attested: payload });
    if (normalizeOrigin(payload.origin) !== pageOrigin) {
      return settle('MISMATCH', { attested: payload });
    }
    return settle('VERIFIED', { attested: payload });
  } catch (error) {
    return settle('NO_ATTESTATION', { error: String(error?.message || error) });
  }
}

/**
 * What the wallet will show, derived from facts we can measure without an
 * attestation: the project's allowlist and the identity the SDK declares.
 *
 * This is a PREDICTION, and it says so: the registry is the input the server
 * uses for `isVerified`, but an attestation can still fail for network reasons
 * on top of it. `probeVerifyAttestation()` measures the real thing; this
 * function is the one that works in CI, on a phone with a dead radio, and in a
 * support thread that has nothing but a pasted allowlist.
 */
export function predictVerifyVerdict({ allowedOrigins, declaredUrl, pageOrigin, attestedOrigin } = {}) {
  const declared = normalizeOrigin(declaredUrl);
  const page = normalizeOrigin(pageOrigin);
  const target = normalizeOrigin(attestedOrigin) || page;
  const facts = { declared, pageOrigin: page, attestedOrigin: target, domains: Array.isArray(allowedOrigins) ? allowedOrigins.length : null };

  if (!Array.isArray(allowedOrigins)) {
    return { ...facts, verdict: 'UNKNOWN', reason: 'NO_LIST', ok: false };
  }
  if (allowedOrigins.length === 0) {
    /* AppKit reads an empty list as «allow everything»; the Verify server does
       not. A project with no domain in its registry cannot verify ANY origin,
       which is exactly the state found on 2026-09-21: the allowlist lived on
       the retired project id, the code had moved to the new one, and every
       pairing since then rendered «Cannot verify». */
    return { ...facts, verdict: 'UNVERIFIED', reason: 'NO_DOMAIN_REGISTERED', ok: false };
  }
  if (!isOriginAllowed(target, allowedOrigins)) {
    return { ...facts, verdict: 'UNVERIFIED', reason: 'ORIGIN_NOT_REGISTERED', ok: false };
  }
  if (declared && target && declared !== target) {
    return { ...facts, verdict: 'MISMATCH', reason: 'METADATA_MISMATCH', ok: false };
  }
  return { ...facts, verdict: 'VALID', reason: 'OK', ok: true };
}

/** One preconnect per window: warming twice warms nothing. */
const warmed = new WeakSet();

/**
 * Open the connection to the enclave BEFORE a pairing needs it.
 *
 * The SDK's attestation has five seconds to: resolve
 * `verify.walletconnect.org`, open TLS, load the enclave page, and have that
 * page post a JWT back. Measured from this app on a filtered mobile network,
 * DNS+TLS alone can eat a large part of that budget — and the failure mode is
 * silent: `register()` returns "", the wallet says «Cannot verify», and
 * nothing anywhere points at the network.
 *
 * `preconnect` warms DNS/TLS; the `no-cors` fetch of `/v3/public-key` opens
 * the HTTP connection the enclave page will then reuse. Neither can fail the
 * caller: a warm-up is an optimisation, and a connect attempt must behave
 * identically whether or not it worked.
 */
export function warmVerifyEnclave({ win, fetchImpl, timeoutMs } = {}) {
  const w = win ?? (typeof window !== 'undefined' ? window : null);
  if (!w) return { warmed: false, reason: 'NO_WINDOW' };
  if (warmed.has(w)) return { warmed: true, reason: 'ALREADY_WARM' };
  warmed.add(w);

  const doc = w.document;
  let links = 0;
  try {
    for (const rel of ['preconnect', 'dns-prefetch']) {
      const link = doc?.createElement?.('link');
      if (!link) break;
      link.rel = rel;
      link.href = VERIFY_SERVER;
      if (rel === 'preconnect') link.crossOrigin = '';
      doc.head?.appendChild?.(link);
      links += 1;
    }
  } catch { /* a headless document — the fetch below is what matters */ }

  const call = fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : null);
  if (call) {
    try {
      const pending = call(`${VERIFY_SERVER_V3}/public-key`, {
        mode: 'no-cors',
        cache: 'no-store'
      });
      /* Fire and forget on purpose: an opaque response carries nothing to
         read, and awaiting it would hold the connect path hostage to a host
         that may simply be filtered here. */
      Promise.resolve(pending).catch(() => {});
      if (pending && typeof pending.finally === 'function') pending.finally(() => {});
    } catch { /* a fetch that throws synchronously is still not fatal */ }
  }
  return { warmed: true, reason: 'STARTED', links, host: VERIFY_SERVER, timeoutMs: timeoutMs ?? null };
}
