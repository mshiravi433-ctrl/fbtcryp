/**
 * Independent completeness watcher protocol (Phase 2c).
 * ---------------------------------------------------------------------------
 * A signed auction close proves what the sealed set was. It cannot prove the
 * sealed set was COMPLETE — a coordinator could verify a quote at admission
 * time and still leave it out of the close. Phase 2c closes that claim gap
 * with evidence, not trust:
 *
 *   1. Every admitted quote yields a coordinator-signed admission receipt
 *      (fbt.admission-receipt.v1) pinning (intentHash, entryHash, acceptedAt).
 *   2. Any independent watcher collects receipts it has seen (its own canary
 *      bids, solver submissions, the public admissions endpoint) and evaluates
 *      them against the signed close with one deterministic rule set.
 *   3. The resulting fbt.completeness-report.v1 is reproducible by ANY third
 *      party from the same inputs: given the same close and receipts, every
 *      honest verifier derives the same classifications, counts and verdict.
 *      A watcher therefore cannot misreport with a valid key — the FBT server
 *      re-evaluates every submitted report before storing it, and the offline
 *      CLI verifies reports without contacting FBT at all.
 *
 * Honest boundary: ordering across serverless instances rests on timestamps,
 * so a receipt inside ±clockSkewAllowanceMs of the seal classifies as
 * 'ambiguous-window' (possibly censored, possibly raced), never as proof.
 * Hard misconduct ('misconduct-evident') requires a receipt strictly before
 * the skew window sealed out of the close, or a close that marked pre-seal
 * evidence as late.
 */

import { createHash } from 'node:crypto';
import { blobConfigured } from './blobCache.js';
import {
  canonicalValue,
  parseSolverRegistry,
  publicKeyFromPrivateKey,
  signCanonicalPayload,
  verifyCanonicalSignature
} from './intentSignatures.js';
import { verifyAuctionClose } from './intentAuctions.js';
import { verifyAdmissionReceipt } from './intentAdmissions.js';

export const COMPLETENESS_REPORT_SCHEMA = 'fbt.completeness-report.v1';
export const WATCHER_SIGNING_DOMAIN = 'fbt.completeness-report.v1/signature';
const REPORT_ID_DOMAIN = 'fbt.completeness-report.v1/id';
const RECORD_SCHEMA = 'fbt.watcher-report-record.v1';
const TX_RE_64 = /^0x[a-fA-F0-9]{64}$/;
const ID_RE = /^[a-z0-9][a-z0-9._-]{1,47}$/;
const MAX_REPORT_RECEIPTS = 256;
const MAX_STORED_REPORTS_PER_INTENT = 64;
const TOKEN = process.env.BLOB_READ_WRITE_TOKEN || '';
const PREFIX = 'intent-auction/v1/watchers/';
const memory = new Map();
const pending = new Set();
let blobApi = null;

const sha256Hex = (value) => `0x${createHash('sha256').update(value).digest('hex')}`;
const same = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();
const safeIntent = (value) => TX_RE_64.test(String(value || '')) ? String(value).toLowerCase() : null;

export function clockSkewAllowanceMs() {
  const parsed = Number(process.env.INTENT_WATCHER_SKEW_MS);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 60000 ? Math.floor(parsed) : 2000;
}

/** Watchers authenticate with the same registry JSON shape as solvers. */
export function parseWatcherRegistry(raw = process.env.INTENT_WATCHER_KEYS || '') {
  return parseSolverRegistry(raw);
}

export function watcherConfigFromPrivateKey(privateKey = process.env.INTENT_WATCHER_PRIVATE_KEY || '') {
  if (!privateKey) return null;
  const id = String(process.env.INTENT_WATCHER_ID || 'independent-watcher').toLowerCase();
  if (!ID_RE.test(id)) return null;
  try {
    return {
      id,
      name: String(process.env.INTENT_WATCHER_NAME || id).replace(/[<>"'`\\]/g, '').slice(0, 80),
      privateKey,
      publicKey: publicKeyFromPrivateKey(privateKey)
    };
  } catch {
    return null;
  }
}

/* ------------------------- deterministic evaluation ---------------------- */

function closeSets(close) {
  const eligible = Array.isArray(close.decision?.eligibleEntryHashes) ? close.decision.eligibleEntryHashes : [];
  const rejected = Array.isArray(close.decision?.rejected) ? close.decision.rejected : [];
  const late = Array.isArray(close.observedLateEntryHashes) ? close.observedLateEntryHashes : [];
  return {
    eligible: new Set(eligible.map((h) => String(h).toLowerCase())),
    rejected: new Set(rejected.map((row) => String(row?.entryHash || '').toLowerCase())),
    late: new Set(late.map((h) => String(h).toLowerCase()))
  };
}

function classifyReceipt(receipt, close, sets, skewMs) {
  const valid = verifyAdmissionReceipt(receipt, { intentHash: close.intentHash });
  if (!valid) return 'invalid';
  if (!same(receipt.coordinator?.publicKey, close.coordinator?.publicKey)) return 'invalid';
  const entry = String(receipt.entryHash).toLowerCase();
  const at = Number(receipt.acceptedAt);
  if (sets.eligible.has(entry)) return 'eligible';
  if (sets.rejected.has(entry)) return 'rejected';
  /* The close labelled this entry late, but a pre-window receipt contradicts
     the signed seal time: the coordinator's two signatures disagree, which is
     misconduct evidence as hard as an omission. */
  if (sets.late.has(entry)) return at <= close.sealedAt - skewMs ? 'late-contradiction' : 'late-observed';
  if (at <= close.sealedAt - skewMs) return 'omitted-pre-seal';
  if (at > close.sealedAt + skewMs) return at > close.closedAt + skewMs ? 'post-close' : 'ambiguous-window';
  return 'ambiguous-window';
}

/* Rows may carry malformed (classification 'invalid') receipts, so every key
   is string-coerced before comparison; the sort only needs determinism. */
const ROW_SORT = (a, b) => {
  const ak = `${String(a?.entryHash || '')}\n${String(a?.receiptId || '')}`;
  const bk = `${String(b?.entryHash || '')}\n${String(b?.receiptId || '')}`;
  return ak.localeCompare(bk);
};

/**
 * Pure evaluation of receipts against a verified signed close. Same inputs →
 * same classifications, counts and verdict on every machine; this is what
 * makes watcher reports reproducible rather than attestations of opinion.
 */
export function evaluateCompleteness(close, receipts = [], { clockSkewMs = clockSkewAllowanceMs() } = {}) {
  if (!verifyAuctionClose(close)) return { ok: false, code: 'INVALID_AUCTION_CLOSE' };
  if (!Array.isArray(receipts)) return { ok: false, code: 'BAD_RECEIPTS' };
  if (receipts.length > MAX_REPORT_RECEIPTS) return { ok: false, code: 'TOO_MANY_RECEIPTS' };
  const sets = closeSets(close);
  const seen = new Set();
  const rows = [];
  for (const receipt of receipts) {
    const key = typeof receipt?.receiptId === 'string' ? receipt.receiptId.toLowerCase() : null;
    if (key && seen.has(key)) {
      rows.push({
        classification: 'duplicate',
        receiptId: receipt.receiptId,
        entryHash: receipt.entryHash,
        solverId: receipt.solverId,
        acceptedAt: receipt.acceptedAt,
        receipt
      });
      continue;
    }
    if (key) seen.add(key);
    rows.push({
      classification: classifyReceipt(receipt, close, sets, clockSkewMs),
      receiptId: receipt?.receiptId,
      entryHash: receipt?.entryHash,
      solverId: receipt?.solverId,
      acceptedAt: receipt?.acceptedAt,
      receipt
    });
  }
  rows.sort(ROW_SORT);

  const counts = {
    submitted: receipts.length,
    invalid: 0,
    duplicates: 0,
    eligible: 0,
    rejected: 0,
    lateObserved: 0,
    lateContradiction: 0,
    omittedPreSeal: 0,
    ambiguousWindow: 0,
    postClose: 0
  };
  for (const row of rows) {
    if (row.classification === 'invalid') counts.invalid += 1;
    else if (row.classification === 'duplicate') counts.duplicates += 1;
    else if (row.classification === 'eligible') counts.eligible += 1;
    else if (row.classification === 'rejected') counts.rejected += 1;
    else if (row.classification === 'late-observed') counts.lateObserved += 1;
    else if (row.classification === 'late-contradiction') counts.lateContradiction += 1;
    else if (row.classification === 'omitted-pre-seal') counts.omittedPreSeal += 1;
    else if (row.classification === 'ambiguous-window') counts.ambiguousWindow += 1;
    else if (row.classification === 'post-close') counts.postClose += 1;
  }

  let verdict = 'unmonitored';
  if (rows.length) {
    verdict = 'complete';
    if (counts.ambiguousWindow > 0) verdict = 'inconclusive';
    if (counts.invalid > 0) verdict = 'inconclusive';
    if (counts.omittedPreSeal > 0 || counts.lateContradiction > 0) verdict = 'misconduct-evident';
  }
  return { ok: true, rows, counts, verdict, clockSkewMs };
}

function reportIdFor(core) {
  return sha256Hex(`${REPORT_ID_DOMAIN}\n${JSON.stringify(canonicalValue(core))}`);
}

/**
 * Build a (optionally signed) completeness report. `watcher` is the public
 * identity; `privateKey` produces a submittable signed report.
 */
export function buildCompletenessReport({
  close,
  receipts = [],
  watcher,
  privateKey = null,
  clockSkewMs = clockSkewAllowanceMs(),
  now = Date.now()
} = {}) {
  const evaluation = evaluateCompleteness(close, receipts, { clockSkewMs });
  if (!evaluation.ok) return evaluation;
  if (!watcher
    || !ID_RE.test(String(watcher.id || ''))
    || typeof watcher.publicKey !== 'string'
    || !Number.isSafeInteger(now)) {
    return { ok: false, code: 'BAD_WATCHER' };
  }
  const core = {
    schema: COMPLETENESS_REPORT_SCHEMA,
    intentHash: close.intentHash,
    closeId: close.closeId,
    closeSummary: {
      sealedAt: close.sealedAt,
      closedAt: close.closedAt,
      logRoot: close.logRoot,
      logSize: close.logSize,
      coordinatorId: close.coordinator?.id,
      coordinatorPublicKey: close.coordinator?.publicKey
    },
    evaluatedAt: now,
    clockSkewAllowanceMs: clockSkewMs,
    receipts: evaluation.rows,
    counts: evaluation.counts,
    verdict: evaluation.verdict,
    claims: {
      closeSignatureVerified: true,
      receiptSignaturesVerified: true,
      observedReceiptCoverageOnly: true,
      globalBidUniverseKnown: false,
      executionOrFundsAuthorised: false
    },
    watcher: {
      id: watcher.id,
      name: String(watcher.name || watcher.id).replace(/[<>"'`\\]/g, '').slice(0, 80),
      publicKey: watcher.publicKey,
      algorithm: 'Ed25519'
    }
  };
  const reportId = reportIdFor(core);
  const unsigned = { ...core, reportId };
  return {
    ok: true,
    report: {
      ...unsigned,
      signature: privateKey ? signCanonicalPayload(WATCHER_SIGNING_DOMAIN, unsigned, privateKey) : null
    }
  };
}

/**
 * Verify a signed report. `close` is mandatory — a report is meaningless
 * without the exact signed close it evaluated. When `registry` is given with
 * `requireRegistered`, the watcher must be an active registered identity and
 * the report key must match the registry row, so key hijack under a known id
 * fails. Without a registry the signature still verifies against the pinned
 * watcher key (offline / third-party verification).
 */
export function verifyCompletenessReport(report, {
  registry = null,
  close = null,
  requireRegistered = false
} = {}) {
  if (!report
    || typeof report !== 'object'
    || Array.isArray(report)
    || report.schema !== COMPLETENESS_REPORT_SCHEMA
    || !TX_RE_64.test(String(report.reportId || ''))) {
    return { ok: false, code: 'BAD_REPORT_BODY' };
  }
  if (!close || !verifyAuctionClose(close)) return { ok: false, code: 'INVALID_AUCTION_CLOSE' };
  if (!same(report.intentHash, close.intentHash) || !same(report.closeId, close.closeId)) {
    return { ok: false, code: 'REPORT_CLOSE_MISMATCH' };
  }
  const summary = report.closeSummary || {};
  if (!Number.isSafeInteger(summary.sealedAt) || summary.sealedAt !== close.sealedAt
    || !Number.isSafeInteger(summary.closedAt) || summary.closedAt !== close.closedAt
    || !same(summary.logRoot, close.logRoot)
    || summary.logSize !== close.logSize
    || summary.coordinatorId !== close.coordinator?.id
    || !same(summary.coordinatorPublicKey, close.coordinator?.publicKey)) {
    return { ok: false, code: 'REPORT_CLOSE_MISMATCH' };
  }
  if (!Number.isSafeInteger(report.evaluatedAt)
    || !Number.isInteger(report.clockSkewAllowanceMs)
    || report.clockSkewAllowanceMs < 0
    || report.clockSkewAllowanceMs > 60000) {
    return { ok: false, code: 'BAD_EVALUATION_META' };
  }
  const watcher = report.watcher;
  if (!watcher || !ID_RE.test(String(watcher.id || '')) || watcher.algorithm !== 'Ed25519') {
    return { ok: false, code: 'BAD_WATCHER' };
  }
  if (registry) {
    const row = registry.get(watcher.id);
    if (!row || !row.active || row.publicKey !== watcher.publicKey) {
      return { ok: false, code: requireRegistered ? 'UNREGISTERED_WATCHER' : 'WATCHER_NOT_IN_REGISTRY' };
    }
  } else if (requireRegistered) {
    return { ok: false, code: 'WATCHER_REGISTRY_REQUIRED' };
  }

  const embedded = Array.isArray(report.receipts) ? report.receipts.map((row) => row?.receipt) : null;
  if (!embedded || embedded.length > MAX_REPORT_RECEIPTS) return { ok: false, code: 'BAD_RECEIPTS' };
  const recomputed = evaluateCompleteness(close, embedded, { clockSkewMs: report.clockSkewAllowanceMs });
  if (!recomputed.ok) return { ok: false, code: recomputed.code };
  if (report.verdict !== recomputed.verdict
    || JSON.stringify(canonicalValue(report.counts)) !== JSON.stringify(canonicalValue(recomputed.counts))
    || JSON.stringify(canonicalValue(report.receipts)) !== JSON.stringify(canonicalValue(recomputed.rows))) {
    return { ok: false, code: 'REPORT_RECOMPUTE_MISMATCH' };
  }
  const claims = report.claims;
  if (!claims
    || claims.closeSignatureVerified !== true
    || claims.receiptSignaturesVerified !== true
    || claims.observedReceiptCoverageOnly !== true
    || claims.globalBidUniverseKnown !== false
    || claims.executionOrFundsAuthorised !== false) {
    return { ok: false, code: 'REPORT_CLAIMS_MISMATCH' };
  }
  const { signature, reportId, ...core } = report;
  if (reportIdFor(core) !== reportId) return { ok: false, code: 'BAD_REPORT_ID' };
  if (!verifyCanonicalSignature(WATCHER_SIGNING_DOMAIN, { ...core, reportId }, signature, watcher.publicKey)) {
    return { ok: false, code: 'WATCHER_SIGNATURE_MISMATCH' };
  }
  return { ok: true, report, recomputed };
}

/* ---------------------------- immutable storage -------------------------- */

async function blob() {
  if (!blobConfigured()) return null;
  if (!blobApi) {
    try { blobApi = await import('@vercel/blob'); } catch { return null; }
  }
  return blobApi;
}

const watchDirFor = (intentHash) => `${PREFIX}${intentHash.slice(2)}/`;
const recordPathFor = (intentHash, watcherId, reportId) =>
  `${watchDirFor(intentHash)}${watcherId}/${reportId.slice(2)}.json`;

export async function storeWatcherReport(intentHash, report) {
  const intent = safeIntent(intentHash);
  if (!intent || !TX_RE_64.test(String(report?.reportId || '')) || !ID_RE.test(String(report?.watcher?.id || ''))) {
    return { ok: false, code: 'BAD_REPORT_BODY' };
  }
  const path = recordPathFor(intent, report.watcher.id, report.reportId);
  /* A reportId is a pure function of the signed core, so an existing record
     at the same path is byte-identical: returning it is idempotent replay,
     never an overwrite. */
  const asDuplicate = async () => {
    try {
      const found = (await listRecords(intent)).find((item) => item.path === path);
      return found
        ? { ok: true, alreadyReported: true, record: found }
        : { ok: false, code: 'WATCHER_STORE_UNAVAILABLE' };
    } catch {
      return { ok: false, code: 'WATCHER_STORE_UNAVAILABLE' };
    }
  };
  if (memory.has(path) || pending.has(path)) return asDuplicate();
  pending.add(path);
  try {
    const existingCount = await countStoredReports(intent);
    if (existingCount == null) return { ok: false, code: 'WATCHER_STORE_UNAVAILABLE' };
    if (existingCount >= MAX_STORED_REPORTS_PER_INTENT) return { ok: false, code: 'WATCHER_REPORTS_FULL' };

    const record = { schema: RECORD_SCHEMA, path, storedAt: Date.now(), report };
    const mod = await blob();
    if (blobConfigured() && !mod) return { ok: false, code: 'WATCHER_STORE_UNAVAILABLE' };
    if (mod) {
      try {
        await mod.put(path, JSON.stringify(record), {
          token: TOKEN,
          access: 'public',
          contentType: 'application/json',
          addRandomSuffix: false,
          allowOverwrite: false,
          cacheControlMaxAge: 31536000
        });
      } catch {
        const duplicate = await asDuplicate();
        return duplicate.ok ? duplicate : { ok: false, code: 'WATCHER_WRITE_FAILED' };
      }
    }
    memory.set(path, record);
    return { ok: true, alreadyReported: false, record };
  } finally {
    pending.delete(path);
  }
}

async function listRecords(intentHash) {
  const rows = [...memory.entries()]
    .filter(([key]) => key.startsWith(watchDirFor(intentHash)))
    .map(([, record]) => record);
  if (!blobConfigured()) return rows;
  const mod = await blob();
  if (!mod) throw new Error('WATCHER_STORE_UNAVAILABLE');
  const blobs = [];
  let cursor;
  let guard = 0;
  do {
    const page = await mod.list({ prefix: watchDirFor(intentHash), limit: 1000, cursor, token: TOKEN });
    blobs.push(...(page?.blobs || []));
    guard += page?.blobs?.length || 0;
    if (guard > MAX_STORED_REPORTS_PER_INTENT * 4) throw new Error('WATCHER_STORE_TOO_LARGE');
    if (page?.hasMore && !page.cursor) throw new Error('WATCHER_STORE_CURSOR_MISSING');
    cursor = page?.hasMore ? page.cursor : undefined;
  } while (cursor);

  const remote = await Promise.all(blobs.map(async (item) => {
    const res = await fetch(item.url, { cache: 'no-store' });
    if (!res.ok) throw new Error('WATCHER_RECORD_UNREADABLE');
    const record = await res.json();
    if (record?.schema !== RECORD_SCHEMA || record.path !== item.pathname) {
      throw new Error('INVALID_STORED_WATCHER_REPORT');
    }
    return record;
  }));
  const byPath = new Map([...remote, ...rows].map((record) => [record.path, record]));
  return [...byPath.values()];
}

async function countStoredReports(intentHash) {
  try {
    return (await listRecords(intentHash)).length;
  } catch {
    return null;
  }
}

/**
 * Read every stored report for an intent and re-verify it against the given
 * close. Registry membership is intentionally NOT re-checked on read: a
 * legitimate watcher rotation must not erase historical evidence.
 */
export async function readWatcherReports(intentHash, close) {
  const intent = safeIntent(intentHash);
  if (!intent) return { error: 'BAD_INTENT_HASH' };
  try {
    const records = await listRecords(intent);
    const verified = [];
    for (const record of records) {
      const check = verifyCompletenessReport(record.report, { close });
      if (!check.ok) return { error: 'INVALID_STORED_WATCHER_REPORT' };
      verified.push(record);
    }
    verified.sort((a, b) => String(a.report?.reportId).localeCompare(String(b.report?.reportId)));
    return { reports: verified };
  } catch {
    return { error: 'WATCHER_STORE_UNAVAILABLE' };
  }
}

/** Public projection of a stored record: no storage internals. */
export function publicWatcherReport(record) {
  const report = record?.report || {};
  return {
    reportId: report.reportId,
    verdict: report.verdict,
    evaluatedAt: report.evaluatedAt,
    clockSkewAllowanceMs: report.clockSkewAllowanceMs,
    receipts: Array.isArray(report.receipts) ? report.receipts.length : 0,
    counts: report.counts,
    watcher: report.watcher ? {
      id: report.watcher.id,
      name: report.watcher.name,
      publicKey: report.watcher.publicKey,
      algorithm: 'Ed25519'
    } : null
  };
}

/**
 * Derive the live, per-auction completeness status from verified reports.
 * Conservative by design: any misconduct report wins, any inconclusive
 * report vetoes 'watcher-verified', and a report that saw zero receipts never
 * upgrades anything by itself.
 */
export function completenessSummary(records = []) {
  const reports = records.map((record) => record?.report || record).filter(Boolean);
  const verdicts = { complete: 0, 'misconduct-evident': 0, inconclusive: 0, unmonitored: 0 };
  let receiptsChecked = 0;
  let latestEvaluatedAt = null;
  const watchers = new Set();
  for (const report of reports) {
    if (verdicts[report.verdict] !== undefined) verdicts[report.verdict] += 1;
    if (report.watcher?.id) watchers.add(report.watcher.id);
    if (Number.isSafeInteger(report.evaluatedAt)) {
      latestEvaluatedAt = Math.max(latestEvaluatedAt ?? 0, report.evaluatedAt);
    }
    receiptsChecked = Math.max(receiptsChecked, Number(report.counts?.submitted) || 0);
  }
  let status = 'unmonitored';
  if (verdicts['misconduct-evident'] > 0) status = 'misconduct-reported';
  else if (verdicts.inconclusive > 0) status = 'inconclusive';
  else if (verdicts.complete > 0) status = 'watcher-verified';
  return {
    status,
    watcherReports: reports.length,
    watchers: [...watchers].sort(),
    receiptsChecked,
    verdicts,
    latestEvaluatedAt,
    /* Completeness is claimed only for admissions watchers actually receipt-
       observed; the universe of bids never seen by any watcher is unknown. */
    scope: 'observed-admission-receipts-only'
  };
}

export function watcherProtocolStatus(registry = parseWatcherRegistry()) {
  const watchers = [...registry.values()].filter((row) => row.active);
  return {
    configured: watchers.length > 0,
    registeredWatchers: watchers.length,
    reportSchema: COMPLETENESS_REPORT_SCHEMA,
    receiptSchema: 'fbt.admission-receipt.v1',
    algorithm: 'Ed25519',
    deterministicEvaluation: true,
    serverRecomputesBeforeStorage: true,
    clockSkewAllowanceMs: clockSkewAllowanceMs(),
    submissionEndpoint: '/api/intents/v1/auctions/{intentHash}/watcher-reports',
    offlineVerifier: 'scripts/intent-watchtower.mjs'
  };
}
