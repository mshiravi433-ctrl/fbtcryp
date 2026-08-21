/**
 * AUTHENTICATED ECOSYSTEM REGISTRY (agents / strategies / liquidity).
 *
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * `server/ecosystemCatalog.js` used to answer every catalog request with an
 * empty list and `dataStatus: 'unavailable'`, because there was nowhere honest
 * to keep a listing. This module is that place: the same durable Blob-backed
 * key/value store `server/developerProjects.js` already uses, with the same
 * two rules —
 *
 *   1. NO DURABLE STORE, NO WRITES. Without `BLOB_READ_WRITE_TOKEN` a write
 *      would land in a per-instance Map and disappear on the next cold start,
 *      so it is refused with `REGISTRY_STORE_UNAVAILABLE` and reads keep
 *      reporting `unavailable` rather than pretending an empty registry is a
 *      live one.
 *   2. OWNERSHIP IS SERVER-SIDE. `ownerId` is the verified Telegram user id
 *      (`req.tgUser.id`), stored inside the record and NEVER echoed to the
 *      public catalog. Only the owner can update or unlist their entry.
 *
 * THE SAFETY BOUNDARY (do not "optimise" this away)
 * ---------------------------------------------------------------------------
 * Every write goes through the validators in `server/ecosystemSchemas.js`, and
 * what gets stored is the validator's OUTPUT projected onto an explicit field
 * whitelist — never the raw request body. That is deliberate belt-and-braces:
 * the validators reject `permissions.withdrawFunds`, `executeWithoutUser` and
 * `action.automaticExecution`, and the projection means an unknown extra field
 * (`verified: true`, a signer, a callback URL, an API key) cannot ride along
 * into storage and later be rendered as if the platform vouched for it.
 *
 * Listings are self-reported. `verification.status` is hardcoded to
 * `unverified` on write AND re-asserted on read, because "an unauthenticated
 * registry must never present unverified data as verified" is the one property
 * that must survive a poisoned or hand-edited blob. Reads therefore re-run the
 * validator on every stored row and drop anything that no longer passes.
 *
 * The `store` parameter (last argument, defaulted) is the same seam
 * `src/lib/developerProjects.js` uses for its storage: tests inject an
 * in-memory implementation instead of mocking the module graph.
 */

import { blobConfigured } from './blobCache.js';
import { storeGet, storeSet } from './store.js';
import { validateAgent, validateLiquidityProvider, validateStrategy } from './ecosystemSchemas.js';

/** Registry types. `writable: false` means read-only: no POST route exists. */
export const REGISTRY_TYPES = Object.freeze({
  agent: Object.freeze({ storeKey: 'ecosystem-agents:v1', schema: 'fbt.agent.v1', validate: validateAgent, writable: true }),
  strategy: Object.freeze({ storeKey: 'ecosystem-strategies:v1', schema: 'fbt.strategy.v1', validate: validateStrategy, writable: true }),
  /*
   * Liquidity is intentionally read-only. A liquidity-provider listing implies
   * quoting and settlement claims, and this phase has neither RFQ settlement
   * nor custody, so there is nothing a self-service write could honestly
   * assert. Reads work the moment a durable registry holds validated rows.
   */
  liquidity: Object.freeze({ storeKey: 'ecosystem-liquidity:v1', schema: 'fbt.liquidity-provider.v1', validate: validateLiquidityProvider, writable: false })
});

export const REGISTRY_LIMITATIONS = Object.freeze([
  'Listings are self-reported and are never presented as verified.',
  'No listing can sign, execute, settle or withdraw funds.',
  'Execution always requires an explicit user signature in the wallet.'
]);

const MAX_ROWS = 200;          // per registry type
const MAX_ROWS_PER_OWNER = 20; // per Telegram account, per type
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;
const TEXT_LANGS = new Set(['en', 'fa', 'ar']);
const NAME_MAX = 64;
const DESCRIPTION_MAX = 280;
const CURSOR = /^[A-Za-z0-9._-]{1,80}$/;

/** The real store. Tests pass their own implementation of these three calls. */
const durableStore = Object.freeze({ durable: blobConfigured, get: storeGet, set: storeSet });

const fail = (code) => ({ ok: false, code });

/**
 * Names and descriptions are localized maps (`{ en, fa, ar }`), because the
 * client renders them with an English fallback and must never show a raw key
 * or a hardcoded English string it cannot translate. A plain string is
 * accepted and treated as English.
 */
function localizedText(value, max) {
  if (typeof value === 'string') {
    const text = value.trim().slice(0, max);
    return text ? { en: text } : null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const out = {};
  for (const [lang, text] of Object.entries(value)) {
    if (!TEXT_LANGS.has(lang) || typeof text !== 'string') continue;
    const trimmed = text.trim().slice(0, max);
    if (trimmed) out[lang] = trimmed;
  }
  return Object.keys(out).length ? out : null;
}

const chainList = (value) => (Array.isArray(value) ? value : []).map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 64);
const assetList = (value) => (Array.isArray(value) ? value : [])
  .filter((x) => typeof x === 'string' && /^[A-Za-z0-9._-]{1,16}$/.test(x))
  .map((x) => x.toUpperCase())
  .slice(0, 32);
const httpsUrl = (value) => {
  if (typeof value !== 'string' || value.length > 200) return null;
  try { const url = new URL(value); return url.protocol === 'https:' ? url.toString() : null; } catch { return null; }
};

/**
 * Project a VALIDATED value onto the fields this registry publishes.
 * Anything not named here is dropped on the floor — that is the point.
 */
function projectEntry(type, value) {
  const name = localizedText(value.name, NAME_MAX);
  const description = localizedText(value.description, DESCRIPTION_MAX);
  if (!name) return fail('NAME_REQUIRED');
  const base = { schema: REGISTRY_TYPES[type].schema, id: value.id, name, description, homepage: httpsUrl(value.homepage) };

  if (type === 'agent') {
    return {
      ok: true,
      value: {
        ...base,
        supportedChains: chainList(value.supportedChains),
        executionMode: value.executionMode,
        /* Re-asserted, not copied: the validator already forced both to false. */
        permissions: { withdrawFunds: false, executeWithoutUser: false, requiresUserApproval: true }
      }
    };
  }
  if (type === 'strategy') {
    const policy = value.policy || {};
    const trigger = value.trigger && ['price', 'time', 'portfolio_drift', 'gas'].includes(value.trigger.type)
      ? { type: value.trigger.type, evaluatedBy: 'client' }
      : null;
    return {
      ok: true,
      value: {
        ...base,
        trigger,
        policy: {
          maxAmountUsd: Number(policy.maxAmountUsd),
          maxSlippageBps: Number(policy.maxSlippageBps),
          allowedChains: chainList(policy.allowedChains),
          allowedAssets: assetList(policy.allowedAssets),
          requiresUserApproval: true
        },
        action: { type: 'create_intent', automaticExecution: false }
      }
    };
  }
  return {
    ok: true,
    value: {
      ...base,
      supportedChains: chainList(value.supportedChains),
      capabilities: { custody: false, settlesUserFunds: false, autoQuote: false },
      rfqSettlement: 'unavailable'
    }
  };
}

/** Storage record = projected entry + ownership + honest listing state. */
function buildRecord(type, owner, value, previous = null) {
  const projected = projectEntry(type, value);
  if (!projected.ok) return projected;
  const at = Date.now();
  return {
    ok: true,
    value: {
      ...projected.value,
      ownerId: String(owner),
      ownerRef: 'telegram-user',
      status: 'listed',
      /* Self-reported, always. There is no review pipeline to claim otherwise. */
      verification: { status: 'unverified', method: 'self_reported', reviewedAt: null },
      limitations: [...REGISTRY_LIMITATIONS],
      createdAt: previous?.createdAt || at,
      updatedAt: at
    }
  };
}

/** Public shape: ownership identifiers never leave the server. */
export function publicEntry(row) {
  const { ownerId, ...rest } = row || {};
  return { ...rest, ownerRef: 'telegram-user', verification: { status: 'unverified', method: 'self_reported', reviewedAt: null } };
}

/**
 * Read-side fail-closed pass: a stored row is published only if it still
 * satisfies the validator that admitted it. A row that acquired a forbidden
 * permission (poisoned blob, manual edit, older schema) is dropped, not fixed.
 */
function publishable(type, row) {
  if (!row || typeof row !== 'object' || row.status !== 'listed') return null;
  const validated = REGISTRY_TYPES[type].validate(row);
  if (!validated.ok) return null;
  const projected = projectEntry(type, validated.value);
  if (!projected.ok) return null;
  return { ...row, ...projected.value };
}

async function readRows(type, store) {
  const rows = await store.get(REGISTRY_TYPES[type].storeKey, []);
  return Array.isArray(rows) ? rows : [];
}

/**
 * List one registry type.
 *
 * `dataStatus` is the honest bit: 'live' means a durable registry answered
 * (even with zero rows), 'unavailable' means no durable registry is configured
 * and the empty array is an absence of storage, not an absence of listings.
 */
export async function listRegistry(type, { cursor = null, limit = DEFAULT_LIMIT } = {}, store = durableStore) {
  if (!REGISTRY_TYPES[type]) return { ok: false, code: 'UNKNOWN_REGISTRY_TYPE', dataStatus: 'unavailable', data: [], cursor: null, hasMore: false };
  if (!store.durable()) return { ok: true, dataStatus: 'unavailable', data: [], cursor: null, hasMore: false };

  const size = Math.min(Math.max(Number.parseInt(limit, 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const rows = (await readRows(type, store))
    .map((row) => publishable(type, row))
    .filter(Boolean)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  let start = 0;
  if (cursor !== null && cursor !== undefined && cursor !== '') {
    if (!CURSOR.test(String(cursor))) return { ok: false, code: 'INVALID_CURSOR', dataStatus: 'live', data: [], cursor: null, hasMore: false };
    const index = rows.findIndex((row) => row.id === String(cursor));
    if (index < 0) return { ok: false, code: 'INVALID_CURSOR', dataStatus: 'live', data: [], cursor: null, hasMore: false };
    start = index + 1;
  }

  const page = rows.slice(start, start + size);
  const hasMore = start + size < rows.length;
  return { ok: true, dataStatus: 'live', data: page.map(publicEntry), cursor: hasMore ? page[page.length - 1]?.id || null : null, hasMore };
}

/** Owner-scoped read used by the update/unlist routes (mirrors ownedProject). */
export async function ownedEntry(type, owner, id, store = durableStore) {
  if (!REGISTRY_TYPES[type]) return fail('UNKNOWN_REGISTRY_TYPE');
  if (!store.durable()) return fail('REGISTRY_STORE_UNAVAILABLE');
  const rows = await readRows(type, store);
  const row = rows.find((entry) => entry?.id === String(id));
  if (!row) return fail('ENTRY_NOT_FOUND');
  if (String(row.ownerId) !== String(owner)) return fail('NOT_ENTRY_OWNER');
  return { ok: true, entry: row, rows };
}

async function writeRegistry(type, owner, input, { previous = null, rows }, store) {
  /*
   * THE ONE LINE THAT MATTERS: the type's validator runs on the caller's input
   * and its OUTPUT (never `input`) is what reaches storage.
   */
  const validated = REGISTRY_TYPES[type].validate({ ...input, schema: REGISTRY_TYPES[type].schema });
  if (!validated.ok) return validated;
  const record = buildRecord(type, owner, validated.value, previous);
  if (!record.ok) return record;
  const next = [record.value, ...rows.filter((row) => row?.id !== record.value.id)].slice(0, MAX_ROWS);
  await store.set(REGISTRY_TYPES[type].storeKey, next);
  return { ok: true, entry: publicEntry(record.value), created: !previous };
}

/**
 * Edge screening for a write, independent of storage.
 *
 * Called by the routes BEFORE an idempotency key is claimed so that an unsafe
 * or malformed listing is refused even when no durable registry is configured.
 * A request asking for `withdrawFunds`, `executeWithoutUser` or
 * `action.automaticExecution` must get the same "no" whether the store is up,
 * down or missing — a permission check that only runs when storage happens to
 * be configured is not a permission check.
 */
export function screenRegistryInput(type, input = {}) {
  const meta = REGISTRY_TYPES[type];
  if (!meta) return fail('UNKNOWN_REGISTRY_TYPE');
  if (!meta.writable) return fail('TYPE_NOT_WRITABLE');
  const validated = meta.validate({ ...input, schema: meta.schema });
  if (!validated.ok) return validated;
  const projected = projectEntry(type, validated.value);
  if (!projected.ok) return projected;
  return { ok: true, value: projected.value };
}

export async function createRegistryEntry(type, owner, input = {}, store = durableStore) {
  const meta = REGISTRY_TYPES[type];
  if (!meta) return fail('UNKNOWN_REGISTRY_TYPE');
  if (!meta.writable) return fail('TYPE_NOT_WRITABLE');
  if (!store.durable()) return fail('REGISTRY_STORE_UNAVAILABLE');
  const rows = await readRows(type, store);
  const existing = rows.find((row) => row?.id === String(input?.id || ''));
  if (existing) return fail(String(existing.ownerId) === String(owner) ? 'DUPLICATE_ENTRY' : 'ENTRY_ID_TAKEN');
  if (rows.filter((row) => String(row?.ownerId) === String(owner)).length >= MAX_ROWS_PER_OWNER) return fail('REGISTRY_LIMIT_REACHED');
  if (rows.length >= MAX_ROWS) return fail('REGISTRY_FULL');
  return writeRegistry(type, owner, input, { previous: null, rows }, store);
}

export async function updateRegistryEntry(type, owner, id, input = {}, store = durableStore) {
  const meta = REGISTRY_TYPES[type];
  if (!meta) return fail('UNKNOWN_REGISTRY_TYPE');
  if (!meta.writable) return fail('TYPE_NOT_WRITABLE');
  const owned = await ownedEntry(type, owner, id, store);
  if (!owned.ok) return owned;
  return writeRegistry(type, owner, { ...input, id: owned.entry.id }, { previous: owned.entry, rows: owned.rows }, store);
}

/**
 * Unlist rather than hard-delete: the row keeps its id so the same owner can
 * relist it, and a released id cannot be grabbed by someone else to inherit a
 * listing users may have seen before.
 */
export async function unlistRegistryEntry(type, owner, id, store = durableStore) {
  const meta = REGISTRY_TYPES[type];
  if (!meta) return fail('UNKNOWN_REGISTRY_TYPE');
  if (!meta.writable) return fail('TYPE_NOT_WRITABLE');
  const owned = await ownedEntry(type, owner, id, store);
  if (!owned.ok) return owned;
  const entry = { ...owned.entry, status: 'unlisted', updatedAt: Date.now() };
  await store.set(meta.storeKey, owned.rows.map((row) => (row?.id === entry.id ? entry : row)));
  return { ok: true, entry: publicEntry(entry), created: false };
}

/** In-memory store implementation — for tests and local probes only. */
export function memoryRegistryStore(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    durable: () => true,
    get: async (key, fallback = null) => (map.has(key) ? map.get(key) : fallback),
    set: async (key, value) => { map.set(key, value); return value; },
    raw: map
  };
}
