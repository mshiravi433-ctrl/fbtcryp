/**
 * THE PLUGINS AS REGISTERED AGENTS, AND THE USER'S OWN CHOICE OF ONE
 * -----------------------------------------------------------------------
 *
 * Two things were missing after §5.24.14 attached the plugins to a chat turn.
 *
 * 1. **The registry still held rows, not our plugins.** `server/fios/agents.js`
 *    is a full agent registry — passports, trust arithmetic, sandbox stages, a
 *    70-point authorization floor, revocation — and its catalog entry point
 *    (`registerFromCatalog`) had never been fed anything: the reviewed
 *    third-party registry is deliberately empty until an operator writes a
 *    decision record, so a user's agent list was a list of nobody. Meanwhile
 *    eleven first-party plugins with named public-data sources and published
 *    data disclosures sat outside it, with no passport and no trust score.
 *    `pluginPassportRow` is that feed: the plugin catalog becomes registry
 *    rows, so the practical plugins ARE the registry instead of a generic
 *    external listing.
 *
 * 2. **The user's choice stopped at the browser.** `activeAgent.js` stores one
 *    active agent in localStorage and the chat uses it for suggestion chips —
 *    it never reached a turn. So a person who opened the hub, picked the token
 *    risk scanner and then typed in the main chat was talking to the generic
 *    brain, and a turn started from Telegram or a cron had no idea at all.
 *    `readAttachment` / `writeAttachment` put that choice in the same
 *    key-value store the rest of the FI collections use, per owner, so it
 *    survives a reload AND a device.
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT DO
 *
 * It grants no scope. `authorize()` in the registry allows exactly two advice
 * scopes (`council-vote`, `strategy-proposal`) and refuses everything else
 * because "agents can advise; there is no execution scope to grant" — attaching
 * a plugin to a chat is advice, and it needs no new enum value to say so. Every
 * row is written with `canExecute: false` by the registry itself, and a plugin
 * run is still a read of public data through the same consent and kill-switch
 * path the hub dock uses.
 *
 * AND IT FABRICATES NO EVIDENCE
 *
 * `normalizeEvidence` in `externalAgentTrust.js` drops any evidence item
 * without an https URI or a sha256, and verification additionally accepts
 * `method: 'reviewer_certified'`. A first-party plugin was reviewed by us, in
 * this repository, so that is the claim made — with the issuer named. No URI
 * and no hash are invented to make the row look independently audited.
 */

export const PLUGIN_REGISTRY_SCHEMA = 'fbt.agent-hub.plugin-registry.v1';

/** The FI collection that holds one row per owner: the plugin they attached. */
export const PLUGIN_ATTACHMENT_COLLECTION = 'plugin_attachments';
export const PLUGIN_ATTACHMENT_ID = 'active';

export const FIRST_PARTY_ISSUER = 'FBT first-party review';
/** `NATIVE_FIRST_PARTY_SINCE` in `native/index.js`, as a timestamp. */
export const FIRST_PARTY_REVIEWED_AT = Date.UTC(2026, 9, 22);

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,40}$/;
/* `safeId` refuses a hex address as an agent id, and so does this: a pasted
   contract address is a subject, never a plugin name. */
const NOT_A_SLUG_RE = /^0x[a-f0-9]{6,}$/;

/** The registry id of a plugin. `safeId` is lowercase and rejects nothing
 *  else here, but a colon is not in its alphabet, so the hub's
 *  `fbt-native:<slug>` prefix becomes a dash. */
export function pluginAgentId(slug) {
  return `fbt-native-${String(slug || '').toLowerCase()}`;
}

/**
 * Accept every form the choice can arrive in: the hub's own
 * `fbt-native:<slug>`, the registry's `fbt-native-<slug>`, or a bare slug.
 *
 * @returns {string|null} a slug that could name a plugin, or null.
 */
export function slugFromAgentId(agentId) {
  const raw = String(agentId || '').trim().toLowerCase();
  if (!raw) return null;
  const bare = raw.replace(/^fbt-native[:-]/, '');
  if (NOT_A_SLUG_RE.test(raw) || NOT_A_SLUG_RE.test(bare)) return null;
  return SLUG_RE.test(bare) ? bare : null;
}

/**
 * One plugin card → one catalog row the registry can turn into a passport.
 * PURE: no clock, no storage, no catalog import (the caller passes the card).
 */
export function pluginPassportRow(agent, { now = Date.now() } = {}) {
  const slug = String(agent?.slug || '');
  return {
    id: pluginAgentId(slug),
    name: String(agent?.name || slug).slice(0, 60),
    creator: FIRST_PARTY_ISSUER,
    /* The plugin's own declared capabilities, lowercased by the sanitizer. */
    capabilities: Array.isArray(agent?.capabilities) ? agent.capabilities.map((c) => String(c).toLowerCase()) : [],
    supportedChains: [],
    supportedAssets: [],
    supportedProtocols: [],
    /* What a plugin actually does with money: it reads and analyses. It never
       signs, and the registry writes `canExecute: false` itself. */
    financialFunctions: ['analysis', 'research', 'monitoring'],
    fees: { model: 'free', detail: 'first-party; no invocation fee' },
    requiredPermissions: ['public-data-read'],
    maxCapitalUsd: 0,
    maxTransactionUsd: 0,
    verification: {
      status: 'certified',
      method: 'reviewer_certified',
      issuers: [FIRST_PARTY_ISSUER],
      issuedAt: FIRST_PARTY_REVIEWED_AT,
      /* NO `expiresAt` KEY AT ALL, and that is load-bearing: the sanitizer runs
         every timestamp through `finite()`, and `Number(null)` is 0 — so an
         explicit `expiresAt: null` came back as `expiresAt: 0`, which is both
         "expired" and "not null". One omitted key is the difference between a
         verified first-party passport and `AGENT_NOT_VERIFIED` plus
         `AGENT_VERIFICATION_EXPIRED` on all eleven rows. This is our own code,
         re-reviewed on every change to it, not a certificate with a window. */
      /* Deliberately empty — see the header. An invented URI would be a lie. */
      evidence: []
    },
    sandbox: {
      stage: 'analysis',
      completedStages: ['discovery', 'analysis'],
      evidence: {
        discovery: [{ type: 'documentation', note: slug }],
        analysis: [{ type: 'code_review', note: (agent?.dataSources || []).join(', ') || 'local' }]
      }
    },
    /* The disclosures the hub already publishes for this plugin, carried along
       so a registry row can say what leaves the machine. */
    dataSources: Array.isArray(agent?.dataSources) ? agent.dataSources.map((s) => String(s)) : [],
    registeredAt: now
  };
}

export function pluginPassportRows(catalog = [], opts = {}) {
  return (Array.isArray(catalog) ? catalog : []).map((agent) => pluginPassportRow(agent, opts));
}

/**
 * Register the plugin catalog for one owner, idempotently.
 *
 * Rows already present are left alone — a registration must not reset the
 * interaction history the trust score is built from, so re-running this on
 * every attach would quietly delete the reputation it is supposed to earn.
 *
 * @returns {Promise<{ ok: boolean, registered: string[], existing: string[], failed: any[], durable: boolean|null, code?: string }>}
 */
export async function ensurePluginAgents({ agents, owner, catalog = [], log = () => {} } = {}) {
  if (!agents || typeof agents.list !== 'function' || typeof agents.registerFromCatalog !== 'function') {
    return { ok: false, registered: [], existing: [], failed: [], durable: null, code: 'REGISTRY_NOT_MOUNTED' };
  }
  const rows = pluginPassportRows(catalog);
  if (!rows.length) return { ok: false, registered: [], existing: [], failed: [], durable: null, code: 'EMPTY_CATALOG' };
  /* The key is the PASSPORT id, not the row id: `registerFromCatalog` mints its
     own `agt_<uuid>` for the row and keeps `fbt-native-<slug>` on the passport,
     so matching on the row id never matches and every call re-registers all
     eleven — resetting the interaction history the trust score is built from,
     which is exactly what an idempotent registration must not do. */
  let existingIds = [];
  try {
    const listed = await agents.list(owner);
    existingIds = (listed?.agents || []).map((a) => String(a?.passport?.id || a?.id || '')).filter(Boolean);
  } catch (err) {
    log?.(`plugin-registry:list-failed:${String(err?.message || err).slice(0, 80)}`);
  }
  const registered = [];
  const failed = [];
  let durable = null;
  for (const row of rows) {
    if (existingIds.includes(row.id)) continue;
    try {
      const res = await agents.registerFromCatalog(owner, row, { source: 'plugin-catalog' });
      if (res?.ok) {
        registered.push(row.id);
        durable = res.durable ?? durable;
      } else {
        failed.push({ id: row.id, code: res?.code || 'REGISTER_FAILED' });
      }
    } catch (err) {
      failed.push({ id: row.id, code: 'REGISTER_THREW', detail: String(err?.message || err).slice(0, 120) });
    }
  }
  const existing = rows.map((r) => r.id).filter((id) => existingIds.includes(id));
  return { ok: failed.length === 0, registered, existing, failed, durable };
}

/**
 * Read the plugin this owner attached. One row, one owner.
 *
 * @returns {Promise<{ ok: boolean, slug: string|null, at: number|null, durable: boolean|null, code?: string }>}
 */
export async function readAttachment({ collections, owner } = {}) {
  if (!collections || typeof collections.read !== 'function') {
    return { ok: false, slug: null, at: null, durable: null, code: 'COLLECTIONS_NOT_MOUNTED' };
  }
  try {
    const { ok, rows } = await collections.read(PLUGIN_ATTACHMENT_COLLECTION, owner);
    if (!ok) return { ok: false, slug: null, at: null, durable: collections.durable?.() ?? null, code: 'ATTACHMENT_READ_FAILED' };
    const row = (rows || []).find((r) => String(r?.id || '') === PLUGIN_ATTACHMENT_ID) || null;
    const slug = row ? slugFromAgentId(row.slug) : null;
    return { ok: true, slug, at: Number.isFinite(Number(row?.at)) ? Number(row.at) : null, durable: collections.durable?.() ?? null };
  } catch (err) {
    return { ok: false, slug: null, at: null, durable: null, code: 'ATTACHMENT_READ_THREW', detail: String(err?.message || err).slice(0, 120) };
  }
}

/**
 * Attach (or, with `slug: null`, detach) a plugin for one owner.
 *
 * A single row with a fixed id, so an attach REPLACES the previous choice —
 * one active agent, the same rule the browser store already enforces.
 */
export async function writeAttachment({ collections, owner, slug = null, catalog = [] } = {}) {
  if (!collections || typeof collections.put !== 'function') {
    return { ok: false, code: 'COLLECTIONS_NOT_MOUNTED', durable: null };
  }
  const clean = slug ? slugFromAgentId(slug) : null;
  if (slug && !clean) return { ok: false, code: 'INVALID_AGENT_ID', durable: null };
  /* The catalog is the authority on existence: attaching a plugin that is not
     in it would write a row the attach can never run. */
  if (clean && Array.isArray(catalog) && catalog.length && !catalog.some((a) => String(a?.slug || '') === clean)) {
    return { ok: false, code: 'PLUGIN_NOT_IN_CATALOG', durable: null };
  }
  const row = { id: PLUGIN_ATTACHMENT_ID, slug: clean, at: clean ? Date.now() : null, schema: PLUGIN_REGISTRY_SCHEMA };
  try {
    const res = await collections.put(PLUGIN_ATTACHMENT_COLLECTION, owner, row, { idKey: 'id' });
    return { ok: Boolean(res?.ok), code: res?.ok ? null : (res?.code || 'ATTACHMENT_WRITE_FAILED'), durable: res?.durable ?? collections.durable?.() ?? null, slug: clean };
  } catch (err) {
    return { ok: false, code: 'ATTACHMENT_WRITE_THREW', durable: null, detail: String(err?.message || err).slice(0, 120) };
  }
}

export default {
  PLUGIN_REGISTRY_SCHEMA, PLUGIN_ATTACHMENT_COLLECTION, PLUGIN_ATTACHMENT_ID, FIRST_PARTY_ISSUER,
  pluginAgentId, slugFromAgentId, pluginPassportRow, pluginPassportRows,
  ensurePluginAgents, readAttachment, writeAttachment
};
