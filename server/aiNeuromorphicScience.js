/**
 * FBT NEUROMORPHIC 2050 — PHASE 7: UNIVERSAL SCIENTIFIC MEMORY (SERVER SIDE)
 * ===========================================================================
 * The device module (`src/lib/neuromorphic/scientificMemory.js`) owns the
 * statistics. This file owns the parts that only make sense off-device:
 *
 *   1. EVIDENCE PROBE — the statistics engine is deterministic, so the server
 *      can run *exactly* the same seeded probe and publish the measured FDR /
 *      power / shrinkage / coverage numbers. A claim nobody can reproduce is
 *      not evidence.
 *
 *   2. WORLD REGISTRY — "universal" needs more than one device. Devices upload
 *      a portable *prior packet*: log Bayes factors and effective counts of the
 *      pre-specified hypothesis families. No prices, no vectors, no episodes,
 *      no device ids — and therefore nothing to leak if it were ever exposed.
 *
 * Hard rules that keep the registry from becoming a rumour mill:
 *   · only pre-specified family keys are accepted (no invented buckets);
 *   · |log10 BF| per record ≤ 24, and each record is winsorised to ±6 before
 *     aggregation, so one device cannot shout down the world;
 *   · one packet per salted owner per 24 h, duplicates rejected by packet hash;
 *   · a key is only reported as `consensus` when at least TWO independent
 *     owners contributed — a single contributor stays a `claim`;
 *   · responses always carry the storage mode, because without Blob storage
 *     this registry is per-instance and must not pretend to be global.
 *
 * The registry never returns a probability of profit, never ranks markets and
 * never touches funds: `canExecute: false`, `canSign: false`.
 */

import {
  PRESPECIFIED_FAMILIES,
  REGIMES,
  SCIENCE_PRIOR_SCHEMA,
  SCIENCE_SCHEMA,
  bayesBand,
  contentHash,
  probeScientificMemory
} from '../src/lib/neuromorphic/scientificMemory.js';
import { containsSensitiveKeyOrPhrase } from '../src/lib/intent-ai/orchestrator/redact.js';

export const NEUROMORPHIC_SCIENCE_SCHEMA = 'fbt.neuromorphic.science-endpoint.v1';
export const SCIENCE_REGISTRY_KEY = 'fbt.ai.neuromorphic.science.world.v1';
export const SCIENCE_REGISTRY_SCHEMA = 'fbt.neuromorphic.science.world.v1';

const CACHE_TTL_MS = 60_000;
const MAX_PACKETS = 400;
const MAX_RECORD_LOG10_BF = 24;
const WINSOR_LOG10_BF = 6;
const ONE_DAY = 24 * 3600_000;
const FAMILY_IDS = new Set(PRESPECIFIED_FAMILIES.map((f) => f.id));

let probeCache = { at: 0, key: '', payload: null };

/** Deterministic, cached statistics report. Measured, never asserted. */
export function getScienceProbeReport({
  nullTests = 240,
  altTests = 40,
  seed = 0x2050fb71,
  now = () => Date.now()
} = {}) {
  const ts = now();
  const key = `${nullTests}|${altTests}|${seed}`;
  if (probeCache.payload && key === probeCache.key && ts - probeCache.at < CACHE_TTL_MS) {
    return { ...probeCache.payload, cached: true, at: ts };
  }
  const probe = probeScientificMemory({ nullTests, altTests, seed });
  const payload = {
    ok: true,
    schema: NEUROMORPHIC_SCIENCE_SCHEMA,
    coreSchema: SCIENCE_SCHEMA,
    zeroServerGpu: true,
    deviceCompute: true,
    families: PRESPECIFIED_FAMILIES.map((f) => ({
      id: f.id,
      kind: f.kind,
      direction: f.direction,
      minSamples: f.minSamples,
      minProspective: f.minProspective
    })),
    regimes: REGIMES,
    measured: probe.measured,
    honesty: {
      ...probe.honesty,
      accuracyPrefilled: false,
      rawDataCollected: false,
      note:
        'The probe simulates the statistics engine only. The world registry stores the log Bayes factors and effective counts of pre-specified families, never prices, vectors or device identifiers; a key needs two independent owners before it is labelled consensus.'
    },
    laws: { canExecute: false, canSign: false, canMoveFunds: false, zeroServerGpu: true },
    at: ts
  };
  probeCache = { at: ts, key, payload };
  return { ...payload, cached: false };
}

/** Test hook: forget the cached probe. */
export function __resetScienceProbeCache() {
  probeCache = { at: 0, key: '', payload: null };
}

/* ── World registry ────────────────────────────────────────────────────────── */

function emptyWorld() {
  return {
    schema: SCIENCE_REGISTRY_SCHEMA,
    packets: [], // { hash, owner, at, records: [{ key, log10BayesFactor }] }
    owners: {}, // owner -> lastAcceptedAt
    totals: { accepted: 0, rejected: 0, duplicates: 0 }
  };
}

/**
 * Validate one uploaded packet. Returns `{ ok, code, records }` — the caller
 * decides whether the rejection is a 400 or a silent no-op.
 */
export function validatePriorPacket(packet) {
  if (!packet || typeof packet !== 'object') return { ok: false, code: 'INVALID_PACKET' };
  if (packet.schema !== SCIENCE_PRIOR_SCHEMA) return { ok: false, code: 'WRONG_SCHEMA' };
  if (!Array.isArray(packet.records)) return { ok: false, code: 'NO_RECORDS' };
  if (containsSensitiveKeyOrPhrase(JSON.stringify(packet).slice(0, 20_000))) {
    return { ok: false, code: 'SECRET_INPUT_REJECTED' };
  }
  if (packet.records.length > 64) return { ok: false, code: 'TOO_MANY_RECORDS' };

  const records = [];
  let rejected = 0;
  for (const rec of packet.records) {
    const key = String(rec?.key || '');
    const [family, regime] = key.split('|');
    const bf = Number(rec?.log10BayesFactor);
    if (!FAMILY_IDS.has(family) || !REGIMES.includes(regime)) {
      rejected += 1;
      continue;
    }
    if (!Number.isFinite(bf) || Math.abs(bf) > MAX_RECORD_LOG10_BF) {
      rejected += 1;
      continue;
    }
    records.push({ key, log10BayesFactor: Math.round(bf * 10_000) / 10_000 });
  }
  if (records.length === 0) return { ok: false, code: 'NO_VALID_RECORDS', rejected };
  return { ok: true, code: 'OK', records, rejected };
}

/** Winsorised mean-of-evidence aggregation with contributor accounting. */
export function aggregateWorld(packets = []) {
  const byKey = new Map();
  for (const packet of packets) {
    for (const rec of packet.records || []) {
      const cell = byKey.get(rec.key) || { contributors: new Set(), values: [] };
      cell.contributors.add(packet.owner);
      cell.values.push(Math.max(-WINSOR_LOG10_BF, Math.min(WINSOR_LOG10_BF, rec.log10BayesFactor)));
      byKey.set(rec.key, cell);
    }
  }
  const keys = [];
  for (const [key, cell] of byKey.entries()) {
    const n = cell.values.length;
    const mean = n ? cell.values.reduce((acc, v) => acc + v, 0) / n : 0;
    const sorted = cell.values.slice().sort((a, b) => a - b);
    const median = n === 0 ? 0 : (n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2);
    const variance = n > 1
      ? cell.values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (n - 1)
      : 0;
    const contributors = cell.contributors.size;
    keys.push({
      key,
      contributors,
      share: Math.round((1 - Math.exp(-contributors)) * 100) / 100,
      log10BayesFactor: Math.round(mean * 10_000) / 10_000,
      medianLog10BayesFactor: Math.round(median * 10_000) / 10_000,
      dispersion: Math.round(Math.sqrt(variance) * 10_000) / 10_000,
      band: bayesBand(mean),
      consensus: contributors >= 2,
      state: contributors >= 2 ? 'consensus' : 'single-claim'
    });
  }
  keys.sort((a, b) => Math.abs(b.log10BayesFactor) - Math.abs(a.log10BayesFactor));
  return keys;
}

export function createScienceRegistry({
  load = async () => null,
  save = async () => {},
  now = () => Date.now(),
  durable = false,
  packLimit = MAX_PACKETS
} = {}) {
  let world = null;
  let hydrating = null;
  /* `durable` may be a provider: the Blob backend is detected asynchronously and
     must not be reported as durable before it is actually configured. */
  const isDurable = () => (typeof durable === 'function' ? Boolean(durable()) : Boolean(durable));

  async function hydrate() {
    if (world) return world;
    if (!hydrating) {
      hydrating = (async () => {
        const stored = await load();
        world = stored && stored.schema === SCIENCE_REGISTRY_SCHEMA ? stored : emptyWorld();
        if (!world.totals) world.totals = { accepted: 0, rejected: 0, duplicates: 0 };
        if (!world.owners) world.owners = {};
        if (!Array.isArray(world.packets)) world.packets = [];
        return world;
      })();
    }
    return hydrating;
  }

  /** Accept one prior packet from one owner. Idempotent per packet hash. */
  async function submitPrior({ owner = 'anon', packet = null } = {}) {
    await hydrate();
    const ts = now();
    const validated = validatePriorPacket(packet);
    if (!validated.ok) {
      world.totals.rejected += 1;
      await save(world);
      return { ok: false, code: validated.code, laws: hardLaws() };
    }

    const hash = packet.packetHash && /^[a-f0-9]{8}$/i.test(String(packet.packetHash))
      ? String(packet.packetHash).toLowerCase()
      : contentHash({ schema: packet.schema, at: packet.at, records: packet.records });

    if (world.packets.some((p) => p.hash === hash)) {
      world.totals.duplicates += 1;
      await save(world);
      return { ok: false, code: 'DUPLICATE_PACKET', packetHash: hash, laws: hardLaws() };
    }

    const last = Number(world.owners[owner] || 0);
    if (ts - last < ONE_DAY) {
      world.totals.rejected += 1;
      await save(world);
      return {
        ok: false,
        code: 'RATE_LIMITED',
        retryAfterMs: ONE_DAY - (ts - last),
        laws: hardLaws()
      };
    }

    if (world.packets.length >= packLimit) {
      // Keep the newest `packLimit - 1` packets so the registry cannot grow without bound.
      world.packets = world.packets.slice(-(packLimit - 1));
    }

    world.packets.push({ hash, owner, at: ts, records: validated.records });
    world.owners[owner] = ts;
    world.totals.accepted += 1;
    await save(world);

    const keys = aggregateWorld(world.packets);
    const mine = keys.filter((k) => validated.records.some((r) => r.key === k.key));
    return {
      ok: true,
      code: 'ACCEPTED',
      packetHash: hash,
      records: validated.records.length,
      rejectedRecords: validated.rejected,
      keys: mine.slice(0, 8),
      totals: { ...world.totals, packets: world.packets.length },
      laws: hardLaws()
    };
  }

  async function getWorld({ limit = 24 } = {}) {
    await hydrate();
    const keys = aggregateWorld(world.packets);
    const consensus = keys.filter((k) => k.consensus);
    return {
      ok: true,
      schema: SCIENCE_REGISTRY_SCHEMA,
      durable: isDurable(),
      storageMode: isDurable() ? 'blob' : 'per-instance',
      totals: {
        packets: world.packets.length,
        owners: Object.keys(world.owners).length,
        keys: keys.length,
        consensusKeys: consensus.length,
        ...world.totals
      },
      consensusShare: keys.length ? Math.round((consensus.length / keys.length) * 100) / 100 : 0,
      keys: keys.slice(0, Math.max(1, Math.min(64, Number(limit) || 24))),
      honesty: {
        rawDataShared: false,
        singleContributorCalledConsensus: false,
        note:
          'Only pre-specified hypothesis families are accepted. Each record is winsorised to ±6 log10 BF, one packet per owner per day, and a key is called consensus only with two or more independent owners.'
      },
      laws: hardLaws(),
      at: now()
    };
  }

  return { submitPrior, getWorld, hydrate, __reset: () => { world = null; hydrating = null; } };
}

const hardLaws = () => ({ canExecute: false, canSign: false, canMoveFunds: false, zeroServerGpu: true });

let registrySingleton = null;
let durableKnown = false;
let durableMode = false;

export function getScienceRegistry() {
  if (registrySingleton) return registrySingleton;
  registrySingleton = createScienceRegistry({
    load: async () => {
      const { storeGet } = await import('./store.js');
      return storeGet(SCIENCE_REGISTRY_KEY);
    },
    save: async (state) => {
      const { storeSet } = await import('./store.js');
      await storeSet(SCIENCE_REGISTRY_KEY, state);
    },
    durable: () => durableMode
  });
  // `storeDurable()` is synchronous; resolve it once without blocking creation.
  import('./store.js')
    .then(({ storeDurable }) => {
      durableMode = Boolean(storeDurable?.());
      durableKnown = true;
    })
    .catch(() => { durableMode = false; durableKnown = true; });
  return registrySingleton;
}

/** Whether the Blob-backed durable store has been detected (for diagnostics). */
export const scienceRegistryDurableKnown = () => durableKnown;
