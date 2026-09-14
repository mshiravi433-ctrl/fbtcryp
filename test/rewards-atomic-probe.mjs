/**
 * FBT REWARDS ATOMIC PROBE — the Redis path, not the fallback.
 * ---------------------------------------------------------------------------
 * The engine and API probes run without Upstash, so they only ever exercise
 * the array fallback. Everything this module exists to prove happens on the
 * other path:
 *
 *   1. IDEMPOTENCY IS ATOMIC — claiming a fingerprint is one `ZADD … NX`
 *      instead of a read-modify-write, so two instances cannot both decide the
 *      same event is new.
 *   2. NO LOST CREDITS — an account's read-modify-write runs under a lease, so
 *      N concurrent batches produce exactly N credits. Without it each batch
 *      reads the same starting counter and the last write erases the rest.
 *   3. THE STORAGE WIN IS REAL — a fingerprint is stored as 8 bytes rather
 *      than the raw 117-character string.
 *   4. THE SEEN-SET STAYS BOUNDED — 400 claims leave at most 300 behind.
 *   5. THE v1 → v2 MIGRATION PRESERVES IDEMPOTENCY — an account that was
 *      already credited under the old format cannot re-earn those points.
 *
 * RUN DIRECTLY: `node test/rewards-atomic-probe.mjs`.
 * It stands up a fake Upstash over `globalThis.fetch` and MUST start before
 * anything imports server/blobCache.js, because that module resolves the
 * Upstash URL and token once, at import time. Importing this probe from
 * run.mjs after other probes would therefore see an unconfigured backend.
 */

/* Credentials first — before the dynamic imports below. */
process.env.UPSTASH_REDIS_REST_URL = 'https://probe-redis.upstash.io';
process.env.UPSTASH_REDIS_REST_TOKEN = 'probe-token-0123456789abcdef';

/* -------------------------------------------------------------------------- */
/* a minimal in-memory Redis, speaking just the commands this path uses        */
/* -------------------------------------------------------------------------- */

const redis = new Map(); // key -> { type, value?, members?, expires? }

function live(key) {
  const rec = redis.get(key);
  if (!rec) return null;
  if (rec.expires && Date.now() > rec.expires) {
    redis.delete(key);
    return null;
  }
  return rec;
}

function zaddNx(key, pairs) {
  let rec = redis.get(key);
  if (!rec || rec.type !== 'zset') {
    rec = { type: 'zset', members: new Map() };
    redis.set(key, rec);
  }
  let added = 0;
  for (const [score, member] of pairs) {
    if (!rec.members.has(member)) {
      rec.members.set(member, Number(score));
      added += 1;
    }
  }
  return added;
}

function zremRangeByRank(key, start, stop) {
  const rec = live(key);
  if (!rec || rec.type !== 'zset') return 0;
  const sorted = [...rec.members.entries()].sort((a, b) => a[1] - b[1]);
  const len = sorted.length;
  /* Redis ranks are INCLUSIVE at both ends and a negative index counts back
     from the end — and, importantly, a stop that falls before the start is an
     EMPTY range, not a request to delete everything. Getting that wrong makes
     the cap look broken: `0 -301` on a 299-member set must remove nothing. */
  let from = Number(start);
  let to = Number(stop);
  if (from < 0) from = Math.max(0, len + from);
  if (to < 0) to = len + to;
  if (to >= len) to = len - 1;
  if (from > to || from >= len) return 0;
  const doomed = sorted.slice(from, to + 1);
  for (const [member] of doomed) rec.members.delete(member);
  return doomed.length;
}

function runEval([script, numKeys, ...rest]) {
  const n = Number(numKeys);
  const keys = rest.slice(0, n);
  const args = rest.slice(n);

  /* the seen-claim script: ZADD NX, then trim to the cap, then arm the TTL */
  if (script.includes('ZADD') && script.includes('ZREMRANGEBYRANK')) {
    const [key] = keys;
    const [member, score, cap, ttl] = args;
    const added = zaddNx(key, [[score, member]]);
    if (added === 1) {
      zremRangeByRank(key, 0, -(Number(cap) + 1));
      live(key).expires = Date.now() + Number(ttl) * 1000;
    }
    return added;
  }
  /* the lease-release script: delete only if we still hold it */
  if (script.includes('GET') && script.includes('DEL')) {
    const [key] = keys;
    const [token] = args;
    const rec = live(key);
    if (rec && rec.type === 'string' && rec.value === String(token)) {
      redis.delete(key);
      return 1;
    }
    return 0;
  }
  throw new Error('probe-redis: unrecognised EVAL script');
}

function runCommand(command) {
  const [name, ...rest] = command;
  switch (String(name).toUpperCase()) {
    case 'SET': {
      const [key, value, ...opts] = rest;
      const nx = opts.includes('NX');
      const exAt = opts.indexOf('EX');
      if (nx && live(key)) return null;
      redis.set(key, {
        type: 'string',
        value: String(value),
        expires: exAt >= 0 ? Date.now() + Number(opts[exAt + 1]) * 1000 : null
      });
      return 'OK';
    }
    case 'GET': {
      const rec = live(rest[0]);
      return rec && rec.type === 'string' ? rec.value : null;
    }
    case 'DEL': {
      const had = redis.has(rest[0]);
      redis.delete(rest[0]);
      return had ? 1 : 0;
    }
    case 'EXPIRE': {
      const rec = live(rest[0]);
      if (!rec) return 0;
      rec.expires = Date.now() + Number(rest[1]) * 1000;
      return 1;
    }
    case 'ZADD': {
      const [key, ...tail] = rest;
      const pairs = tail[0] === 'NX' ? tail.slice(1) : tail;
      const list = [];
      for (let i = 0; i + 1 < pairs.length; i += 2) list.push([pairs[i], pairs[i + 1]]);
      return zaddNx(key, list);
    }
    case 'ZREMRANGEBYRANK':
      return zremRangeByRank(rest[0], rest[1], rest[2]);
    case 'ZCARD': {
      const rec = live(rest[0]);
      return rec && rec.type === 'zset' ? rec.members.size : 0;
    }
    case 'EVAL':
      return runEval(rest);
    default:
      throw new Error(`probe-redis: unsupported command ${name}`);
  }
}

globalThis.fetch = async (_url, init) => ({
  ok: true,
  json: async () => ({ result: runCommand(JSON.parse(init.body)) })
});

/* -------------------------------------------------------------------------- */

const rows = [];
const t = (name, ok) => rows.push([name, Boolean(ok)]);

const kv = await import('../server/rewards/store.js');
const engine = await import('../server/rewards/engine.js');
const { fingerprintKey } = await import('../server/rewards/config.js');
const base = await import('../server/store.js');
const { upstashConfigured } = await import('../server/blobCache.js');

const okVerify = async () => ({ ok: true, source: 'probe-rpc' });
const io = engine.ioDefault(kv);
const DAY = 86400_000;
const now = Date.now();

if (!upstashConfigured()) {
  console.log('  ! skipped: Upstash was not configured, so the atomic path is not live.');
} else {
  t('the atomic backend reports upstash-redis, not the degraded lock', kv.atomicBackend() === 'upstash-redis');

  /* ---------------- 1 · fingerprints are stored small ---------------------- */

  const ownerSize = 'dev:probe-size';
  const rawFp = engine.eventFingerprint(ownerSize, {
    action: 'swap', chainId: 8453, txHash: `0x${'a'.repeat(64)}`,
    wallet: '0x1111111111111111111111111111111111111111'
  });
  await kv.seenAddAtomic(ownerSize, fingerprintKey(rawFp), now);
  const stored = [...(live(kv.seenV2Key(ownerSize))?.members.keys() || [])][0];
  t('a raw 117-character fingerprint is stored as 8 bytes', rawFp.length === 117 && String(stored).length === 16);

  /* ---------------- 2 · atomic idempotency -------------------------------- */

  const ownerIdem = 'dev:probe-idem';
  const ev = {
    id: 'idem-1', action: 'swap', chainId: 8453,
    txHash: `0x${'b'.repeat(64)}`, wallet: '0x2222222222222222222222222222222222222222', at: now
  };
  const first = await engine.ingestEvents({ owner: ownerIdem, events: [ev], io, verify: okVerify });
  const again = await engine.ingestEvents({ owner: ownerIdem, events: [ev], io, verify: okVerify });
  const ledgerIdem = await kv.getLedgerFresh(ownerIdem);
  t('the first claim credits', first.results[0].credited === true);
  t('a replay is refused as a duplicate, not credited twice', again.results[0].duplicate === true);
  t('the ledger holds exactly one credit', ledgerIdem.byAction.swap.count === 1);

  /* ---------------- 3 · no lost credits under concurrency ----------------- */

  const ownerRace = 'dev:probe-race';
  const batches = Array.from({ length: 8 }, (_, b) =>
    Array.from({ length: 3 }, (_, i) => ({
      id: `race-${b}-${i}`, action: 'swap', chainId: 8453,
      txHash: `0x${String(b * 10 + i).padStart(64, '0')}`,
      wallet: '0x3333333333333333333333333333333333333333', at: now
    }))
  );
  const settled = await Promise.all(
    batches.map((events) => engine.ingestEvents({ owner: ownerRace, events, io, verify: okVerify }))
  );
  const credited = settled.flatMap((r) => r.results).filter((r) => r.credited).length;
  const busy = settled.flatMap((r) => r.results).filter((r) => r.code === 'LEDGER_BUSY').length;
  const ledgerRace = await kv.getLedgerFresh(ownerRace);
  t('eight concurrent batches all acquired the lease (none were turned away)', busy === 0);
  t('all 24 concurrent events were credited', credited === 24);
  t('no credit was lost to a concurrent writer', ledgerRace.byAction.swap.count === 24);
  t('the ledger total equals the sum of the credits', ledgerRace.points === 24 + 10 + 25);

  /* ---------------- 4 · the set stays bounded ----------------------------- */

  const ownerCap = 'dev:probe-cap';
  for (let i = 0; i < 400; i += 1) await kv.seenAddAtomic(ownerCap, `member-${i}`, now + i);
  const size = runCommand(['ZCARD', kv.seenV2Key(ownerCap)]);
  t('400 claims leave the seen-set capped at 300', size === 300);

  /* ---------------- 5 · v1 → v2 migration --------------------------------- */

  const ownerMig = 'dev:probe-migration';
  const alreadyCredited = {
    id: 'mig-1', action: 'swap', chainId: 8453,
    txHash: `0x${'c'.repeat(64)}`, wallet: '0x4444444444444444444444444444444444444444', at: now - DAY
  };
  /* What the v1 format would hold for an account that was credited yesterday. */
  await base.storeSet(kv.seenKey(ownerMig), [
    { k: engine.eventFingerprint(ownerMig, alreadyCredited), at: now - DAY }
  ]);
  const replay = await engine.ingestEvents({
    owner: ownerMig, events: [alreadyCredited], io, verify: okVerify
  });
  const ledgerMig = await kv.getLedgerFresh(ownerMig);
  t('migrated history still blocks a replay — no re-earned points',
    replay.results[0].duplicate === true && !ledgerMig.byAction.swap);
  t('the 42 KB v1 array is emptied once v2 holds it',
    (await base.storeGet(kv.seenKey(ownerMig), null))?.length === 0);
  t('the migrated fingerprint survives in v2', runCommand(['ZCARD', kv.seenV2Key(ownerMig)]) === 1);
}

/* --------------------------------- done ---------------------------------- */

const invokedDirectly = Boolean(process.argv?.[1] && process.argv[1].endsWith('rewards-atomic-probe.mjs'));
if (invokedDirectly) {
  const fails = rows.filter(([, ok]) => !ok);
  for (const [name, ok] of rows) console.log(`  ${ok ? '✓' : '✗'} ${name}`);
  console.log(`\npassed ${rows.length - fails.length}/${rows.length}`);
  process.exitCode = fails.length ? 1 : 0;
}

export default rows;
