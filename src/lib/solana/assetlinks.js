/**
 * DIGITAL ASSET LINKS — the identity check Phantom and MWA actually perform.
 * ---------------------------------------------------------------------------
 * «سایت ما را فانتوم مخرب شناخته» is three warnings (see signGuard.js), and the
 * middle one — «This app's identity could not be verified. It may be
 * impersonating another app.» — is decided by ONE fetched file:
 *
 *     https://<claimed origin>/.well-known/assetlinks.json
 *
 * Phantom (and Mobile Wallet Adapter's dapp-identity spec) matches
 *
 *     package_name                === our Android application id
 *     sha256_cert_fingerprints[*] === the certificate the shipped APK is signed with
 *     relation                    ⊇ delegate_permission/common.handle_all_urls
 *
 * against the statements in that array. Anything else — a wrong package, a debug
 * keystore's fingerprint, a file that 404s — produces the warning, and no amount
 * of correct WalletConnect metadata can compensate for it.
 *
 * ─── WHAT THIS MODULE IS, AND WHAT IT REFUSES TO BE ─────────────────────────
 * It is a VALIDATOR and a PROBE. It is not a generator: a fingerprint that was
 * guessed, or copied from a debug build, produces a file that verifies nothing
 * while looking correct — worse than no file, because the next person reads it
 * as done. `scripts/assetlinks.mjs` writes the real one from the real keystore;
 * this module says whether the one that is deployed can possibly work.
 *
 * ─── PLAY APP SIGNING ───────────────────────────────────────────────────────
 * If the release is distributed through Google Play with Play App Signing, the
 * certificate that signs the APK delivered to users is GOOGLE'S signing key, not
 * the upload key this repository holds. The fingerprint to publish is the one
 * printed in Play Console → «Protected with Play» → «Play app signing»
 * (App signing key certificate). Publishing the upload key's fingerprint is the
 * single most common reason this verification fails.
 *
 * Pure, dependency-free, and injectable, so every branch is assertable in Node.
 */

/** Where the file must live. Two path segments, exactly as Android fetches it. */
export const ASSETLINKS_PATH = '/.well-known/assetlinks.json';

/** Android's Digital Asset Links relation that grants an app a whole origin. */
export const HANDLE_ALL_URLS = 'delegate_permission/common.handle_all_urls';

/** The debug-keystore fingerprints that ship inside every Android SDK install. */
export const DEBUG_KEYSTORE_FINGERPRINTS = Object.freeze([
  'FA:C6:17:45:DC:24:43:0D:FC:FE:5D:3B:94:9E:1B:CE:3D:55:83:64:26:9C:6B:7B:C4:BD:9B:7C:2D:72:A5:CD'
]);

const SHA256_RE = /^[0-9A-F]{2}(?::[0-9A-F]{2}){31}$/;
/* The same value without separators. Play Console shows the colon form and
   other tooling prints the bare hex; accepting one spelling only means the
   person copying it gets «not a fingerprint» and assumes the check is broken. */
const SHA256_BARE_RE = /^[0-9A-F]{64}$/;

/**
 * Normalise a fingerprint to the uppercase colon-separated form Android uses.
 * @returns {string|null} null when it is not a SHA-256 fingerprint at all.
 */
export function normalizeFingerprint(raw) {
  const value = String(raw ?? '')
    .trim()
    .replace(/\s+/g, '')
    .toUpperCase();
  if (SHA256_RE.test(value)) return value;
  if (SHA256_BARE_RE.test(value)) return value.match(/../g).join(':');
  return null;
}

/** `/` — the bare origin, never a path variant. Phantom fetches `<origin>/…`. */
export function assetLinksUrl(origin) {
  const base = String(origin ?? '').trim().replace(/\/+$/, '');
  return `${base}${ASSETLINKS_PATH}`;
}

/**
 * Validate a parsed assetlinks.json against the app that claims the domain.
 *
 * @param {unknown} document the parsed JSON
 * @param {{packageName:string, fingerprints?:string[]}} target
 * @returns {{ok:boolean, problems:string[], entries:object[], matched:object|null}}
 */
export function validateAssetLinks(document, { packageName, fingerprints = [] } = {}) {
  const problems = [];
  const entries = Array.isArray(document) ? document : [];
  if (!Array.isArray(document)) problems.push('NOT_AN_ARRAY');
  if (Array.isArray(document) && entries.length === 0) problems.push('EMPTY');

  const pkg = String(packageName ?? '').trim();
  if (!pkg) problems.push('NO_PACKAGE_TO_MATCH');

  const wanted = (fingerprints ?? []).map(normalizeFingerprint).filter(Boolean);
  let matched = null;

  for (const [index, entry] of entries.entries()) {
    const target = entry?.target ?? {};
    const where = `[${index}]`;
    if (target.namespace !== 'android_app') problems.push(`${where}.NAMESPACE_NOT_ANDROID_APP`);
    if (String(target.package_name ?? '') !== pkg) problems.push(`${where}.PACKAGE_MISMATCH`);

    const relation = Array.isArray(entry?.relation) ? entry.relation : [];
    if (!relation.includes(HANDLE_ALL_URLS)) problems.push(`${where}.RELATION_MISSING`);

    const list = Array.isArray(target.sha256_cert_fingerprints) ? target.sha256_cert_fingerprints : [];
    if (list.length === 0) problems.push(`${where}.NO_FINGERPRINTS`);
    const normalised = list.map(normalizeFingerprint);
    normalised.forEach((fp, i) => {
      if (!fp) problems.push(`${where}.FINGERPRINT_${i}_MALFORMED`);
      else if (DEBUG_KEYSTORE_FINGERPRINTS.includes(fp)) problems.push(`${where}.FINGERPRINT_${i}_DEBUG_KEYSTORE`);
    });
    if (wanted.length > 0) {
      const matches = normalised.filter((fp) => fp && wanted.includes(fp));
      if (matches.length === 0) problems.push(`${where}.FINGERPRINT_MISMATCH`);
      else if (!matched) matched = { index, fingerprints: matches };
    } else if (normalised.some(Boolean)) {
      matched = matched ?? { index, fingerprints: normalised.filter(Boolean) };
    }
  }

  return { ok: problems.length === 0, problems, entries, matched, packageName: pkg };
}

/**
 * Fetch the deployed file and validate it, in one call.
 *
 * Never throws. A 404 is `NOT_DEPLOYED` rather than a validation failure: the
 * fix is different (deploy the file) from a wrong package name (regenerate it),
 * and a report that folds the two together sends the reader to the wrong task.
 *
 * @returns {Promise<{ok:boolean, code:string, url:string, status?:number|null,
 *   problems?:string[], error?:string, document?:unknown}>}
 */
export async function checkDeployedAssetLinks({
  origin,
  packageName,
  fingerprints = [],
  fetchImpl,
  timeoutMs = 8_000
} = {}) {
  const url = assetLinksUrl(origin);
  const call = fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : null);
  if (!call) return { ok: false, code: 'NO_FETCH', url, problems: [] };
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => {
    try {
      controller?.abort();
    } catch { /* best effort */ }
  }, timeoutMs);
  try {
    const res = await call(url, { signal: controller?.signal, cache: 'no-store' });
    if (res?.status === 404) return { ok: false, code: 'NOT_DEPLOYED', url, status: 404, problems: [] };
    if (!res?.ok) return { ok: false, code: 'HTTP_ERROR', url, status: res?.status ?? null, problems: [] };
    let document;
    try {
      document = await res.json();
    } catch {
      return { ok: false, code: 'INVALID_JSON', url, status: res.status, problems: [] };
    }
    const result = validateAssetLinks(document, { packageName, fingerprints });
    return {
      ok: result.ok,
      code: result.ok ? 'PASS' : 'INVALID',
      url,
      status: res.status,
      problems: result.problems,
      document
    };
  } catch (error) {
    return {
      ok: false,
      code: error?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_UNREACHABLE',
      url,
      problems: [],
      error: String(error?.message || error)
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The sentence that goes with each code — printed by `assetlinks:check`,
 * `walletconnect:check` and the Wallet Health panel, so all three say the same
 * thing about the same measurement.
 */
export const ASSETLINKS_SENTENCE = Object.freeze({
  PASS: 'the deployed file matches this app: package, relation and certificate fingerprint all agree.',
  NOT_DEPLOYED:
    'the file is not deployed on this origin. Phantom/MWA cannot verify the app identity and shows '
    + '«This app’s identity could not be verified. It may be impersonating another app.»',
  INVALID_JSON: 'the file is deployed but is not valid JSON.',
  INVALID: 'the file is deployed but does not match this app — see the problems list.',
  HTTP_ERROR: 'the host answered with an error; the file could not be read.',
  TIMEOUT: 'the host did not answer inside the budget.',
  NETWORK_UNREACHABLE: 'the host could not be reached from here.',
  NO_FETCH: 'this runtime has no fetch — the check could not run.'
});
