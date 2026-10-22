/**
 * FBT EXTERNAL AGENT HUB — user-supplied agent sources.
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * The reviewed registry (`providers.js`) is deliberately empty: a provider only
 * appears there after a human writes a decision record, states a jurisdiction
 * and accepts the responsibility for the listing. That gate is correct, and it
 * also means the External Agents view has nothing to show on a deployment that
 * has not been through it — which is exactly the state the page was in.
 *
 * This module is the other honest path: THE USER BRINGS THEIR OWN A2A AGENT.
 *
 *   · Nothing is bundled, nothing is suggested, nothing is promoted. The user
 *     pastes a card URL; FBT fetches that card once, and lists the skills the
 *     card actually declares.
 *   · The source is OWNER-SCOPED. It is not a directory entry, it does not
 *     appear to anybody else, and deleting it deletes it for that owner only.
 *   · FBT still verifies the two things it can verify without endorsing anyone:
 *     the URL is a safe outbound destination (HTTPS, no IP literal, no private
 *     host, no credentials, no query string) and the document at the other end
 *     is a valid A2A Agent Card. Everything else — who runs it, what it costs,
 *     what it does with the prompt — is the user's own choice, and the UI says
 *     `source: "user"` next to every listing so the two kinds can never be
 *     confused.
 *   · A source is only stored after that first fetch SUCCEEDS. A typo produces
 *     an error in the add form, not a broken card that stays on the page.
 *
 * The provider object built here is shaped exactly like a registry provider so
 * the adapter, the broker, the kill switches and the consent flow are the same
 * code paths — this file adds a *source of providers*, not a second protocol.
 */

import { createHash } from 'node:crypto';
import { jsonRequest, validateProviderUrl } from './httpSafe.js';

export const USER_SOURCE_SCHEMA = 'fbt.agent-hub.user-sources.v1';

const MAX_SOURCES = 8;
const CARD_MAX_BYTES = 256_000;
const CARD_TIMEOUT_MS = 8_000;
/* One window covers more attempts than the cap holds rows, because a failed
   verification costs a fetch too: a burst of typo'd or hostile URLs must run
   out of budget before it becomes a free request amplifier. */
const ADD_WINDOW_MS = 10 * 60_000;
const ADD_MAX_PER_WINDOW = 12;

/** Card paths that conventionally serve the agent at the origin root. */
const ROOT_DISCOVERY_PATHS = new Set([
  '/', '/card', '/agent.json', '/.well-known/agent.json', '/.well-known/agent-card.json'
]);

const hostOf = (value) => {
  try { return new URL(value).hostname.toLowerCase(); } catch { return ''; }
};
const originOf = (value) => {
  try { return new URL(value).origin; } catch { return null; }
};
const str = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/** Deterministic, owner-scoped id: the same URL for two people is two sources. */
export function sourceIdFor(owner, cardUrl) {
  return `u-${createHash('sha256').update(`${String(owner)}|${String(cardUrl)}`).digest('hex').slice(0, 10)}`;
}

/**
 * One outbound card URL, checked before anything is fetched.
 * Returns `{ ok:true, url, host }` or `{ ok:false, code }`.
 */
export function validateCardUrl(rawUrl, { env = process.env } = {}) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl ?? '').trim());
  } catch {
    return { ok: false, code: 'SOURCE_URL_INVALID' };
  }
  const host = parsed.hostname.toLowerCase();
  /* The allowlist is the host the user named — this call is about the SHAPE of
     the destination (scheme, address, port, credentials), not about trust in
     it. Anything that could reach the deployment's own network is refused. */
  const checked = validateProviderUrl(parsed.toString(), { allowedHosts: [host], env });
  if (!checked.ok) return { ok: false, code: checked.code };
  return { ok: true, url: checked.url, host };
}

/**
 * The agent's RPC endpoint, taken from the card's own `url` field.
 * A card that omits it falls back to the origin ONLY when it was served from a
 * conventional discovery path; otherwise there is no endpoint and the UI says
 * so instead of guessing one.
 */
export function rpcUrlFromCard(card, cardUrl, { env = process.env } = {}) {
  const host = hostOf(cardUrl);
  const declared = typeof card?.url === 'string' ? card.url.trim() : '';
  const candidate = declared || (ROOT_DISCOVERY_PATHS.has(new URL(cardUrl).pathname) ? new URL('/', originOf(cardUrl)).toString() : '');
  if (!candidate) return null;
  try {
    const absolute = new URL(candidate, originOf(cardUrl) || undefined).toString();
    /* A card must not send the task to a different host than the one the user
       added: that would be a redirect by data, and it would hide from the user
       which service their prompt actually reaches. */
    const checked = validateProviderUrl(absolute, { allowedHosts: [host], env });
    return checked.ok ? checked.url : null;
  } catch {
    return null;
  }
}

function normalizeCard(json) {
  const name = str(json?.name, 120);
  if (!name) return { ok: false, code: 'SOURCE_CARD_INVALID' };
  const skills = Array.isArray(json?.skills) ? json.skills : [];
  return {
    ok: true,
    card: {
      name,
      description: str(json?.description, 400),
      version: str(json?.version, 40) || null,
      protocolVersion: str(json?.protocolVersion, 20) || null,
      documentationUrl: /^https:\/\//i.test(String(json?.documentationUrl || '')) ? str(json.documentationUrl, 300) : null,
      skills: skills.length
    }
  };
}

export function createUserAgentSources({
  store,
  env = process.env,
  now = () => Date.now(),
  request = jsonRequest,
  log = () => {}
} = {}) {
  const addWindows = new Map(); // owner -> { count, reset }

  function rateLimited(owner) {
    const at = now();
    const window = addWindows.get(owner);
    if (!window || at > window.reset) {
      addWindows.set(owner, { count: 1, reset: at + ADD_WINDOW_MS });
      return false;
    }
    window.count += 1;
    return window.count > ADD_MAX_PER_WINDOW;
  }

  /** One bounded, allowlisted GET of the card the user named. */
  async function fetchCard(cardUrl) {
    const checked = validateCardUrl(cardUrl, { env });
    if (!checked.ok) return checked;
    const response = await request({
      url: checked.url,
      allowedHosts: [checked.host],
      method: 'GET',
      timeoutMs: CARD_TIMEOUT_MS,
      maxBytes: CARD_MAX_BYTES,
      env
    });
    if (!response.ok) {
      return { ok: false, code: 'SOURCE_CARD_UNREACHABLE', detail: response.code || 'PROVIDER_UNREACHABLE', httpStatus: response.httpStatus || null };
    }
    const normalized = normalizeCard(response.json);
    if (!normalized.ok) return normalized;
    return {
      ok: true,
      url: checked.url,
      host: checked.host,
      card: normalized.card,
      rpcUrl: rpcUrlFromCard(response.json, checked.url, { env })
    };
  }

  async function add({ owner, cardUrl, label = '' } = {}) {
    if (!str(cardUrl, 400)) return { ok: false, code: 'SOURCE_URL_REQUIRED' };
    const checked = validateCardUrl(cardUrl, { env });
    if (!checked.ok) return { ok: false, code: checked.code };

    const existing = await store.listUserSources(owner);
    const already = existing.sources.find((row) => row.cardUrl === checked.url);
    if (already) {
      /* Idempotent by URL: adding the same card twice is a re-check, not a
         duplicate row the user has to clean up. */
      const verified = await fetchCard(checked.url);
      if (verified.ok) {
        const saved = await store.putUserSource(owner, {
          ...already,
          label: str(label, 60) || already.label || '',
          card: verified.card,
          rpcUrl: verified.rpcUrl,
          lastVerifiedAt: now(),
          lastError: null
        });
        return { ok: true, source: { ...already, card: verified.card, lastVerifiedAt: now() }, existing: true, durable: saved.durable };
      }
      return { ok: false, code: verified.code, detail: verified.detail || null };
    }

    if (existing.sources.length >= MAX_SOURCES) return { ok: false, code: 'SOURCE_LIMIT_REACHED' };
    if (rateLimited(owner)) return { ok: false, code: 'SOURCE_RATE_LIMITED', status: 429 };

    const verified = await fetchCard(checked.url);
    if (!verified.ok) {
      log(`agenthub:source-add-failed:${verified.code}`);
      return { ok: false, code: verified.code, detail: verified.detail || null, httpStatus: verified.httpStatus || null };
    }

    const row = {
      id: sourceIdFor(owner, verified.url),
      status: 'ACTIVE',
      cardUrl: verified.url,
      host: verified.host,
      label: str(label, 60),
      card: verified.card,
      rpcUrl: verified.rpcUrl,
      addedAt: now(),
      lastVerifiedAt: now(),
      lastError: null
    };
    const saved = await store.putUserSource(owner, row);
    if (!saved.ok) return { ok: false, code: saved.code || 'STORE_WRITE_FAILED' };
    await store.indexUserSource(owner, row.id);
    return { ok: true, source: row, existing: false, durable: saved.durable };
  }

  async function list({ owner } = {}) {
    const rows = await store.listUserSources(owner);
    return { ok: true, sources: rows.sources.map((row) => ({ ...row, source: 'user' })), durable: rows.durable };
  }

  async function remove({ owner, sourceId } = {}) {
    const id = str(sourceId, 60);
    if (!id) return { ok: false, code: 'SOURCE_NOT_FOUND' };
    const found = await store.getUserSource(owner, id);
    /* Someone else's id is indistinguishable from a missing one — a 404 here is
       the correct answer for both, because the alternative confirms existence. */
    if (!found.ok || found.source?.status === 'REMOVED') return { ok: false, code: 'SOURCE_NOT_FOUND' };
    const deleted = await store.deleteUserSource(owner, id);
    if (!deleted.ok) return { ok: false, code: deleted.code || 'STORE_WRITE_FAILED' };
    return { ok: true, removedId: id, durable: deleted.durable };
  }

  /** Provider-shaped view of one stored row, for the adapter and the broker. */
  function providerFromRow(row) {
    const host = row.host || hostOf(row.cardUrl);
    const name = row.card?.name || row.label || host;
    return {
      id: row.id,
      name,
      websiteUrl: originOf(row.cardUrl),
      documentationUrl: row.card?.documentationUrl || null,
      termsUrl: null,
      privacyUrl: null,
      supportUrl: null,
      integrationType: 'A2A',
      accessModel: 'USER_SUPPLIED',
      approvalStatus: 'USER_SUPPLIED',
      userSupplied: true,
      host,
      allowedHosts: [host],
      cardUrl: row.cardUrl,
      rpcUrl: row.rpcUrl || null,
      authorization: null,
      webhook: null,
      category: 'custom',
      costSummary: '',
      enabled: true,
      lastVerifiedAt: row.lastVerifiedAt || null,
      addedAt: row.addedAt,
      approvalEvidence: {
        reviewedAt: null,
        reviewedBy: 'added by this user',
        documentUrl: null,
        jurisdiction: { operatorJurisdiction: null, targetRegions: [], providerRestrictions: [], accountEligibility: null },
        promptTraining: 'unknown',
        dataRetention: 'unknown',
        notes: null
      }
    };
  }

  /** Public (browser-safe) view: no internal hosts, no review internals. */
  function publicView(provider) {
    return {
      id: provider.id,
      name: provider.name,
      host: provider.host || null,
      websiteUrl: provider.websiteUrl,
      documentationUrl: provider.documentationUrl,
      termsUrl: null,
      privacyUrl: null,
      supportUrl: null,
      integrationType: 'A2A',
      accessModel: 'USER_SUPPLIED',
      approvalStatus: 'USER_SUPPLIED',
      category: provider.category,
      costSummary: provider.costSummary,
      requiresAccount: false,
      requiresPayment: false,
      source: 'user',
      addedAt: provider.addedAt || null,
      jurisdiction: { targetRegions: [], providerRestrictions: [], accountEligibility: null },
      dataPolicy: { promptTraining: 'unknown', dataRetention: 'unknown' },
      reviewedAt: null,
      lastVerifiedAt: provider.lastVerifiedAt || null
    };
  }

  async function providersFor({ owner } = {}) {
    const rows = await store.listUserSources(owner);
    return { ok: true, providers: rows.sources.map(providerFromRow), durable: rows.durable };
  }

  async function providerFor({ owner, providerId } = {}) {
    const id = str(providerId, 60);
    if (!id) return null;
    const found = await store.getUserSource(owner, id);
    if (!found.ok || found.source?.status === 'REMOVED') return null;
    return providerFromRow(found.source);
  }

  return {
    schema: USER_SOURCE_SCHEMA,
    cap: MAX_SOURCES,
    add,
    list,
    remove,
    providersFor,
    providerFor,
    publicView,
    providerFromRow,
    _reset: () => addWindows.clear()
  };
}
