/**
 * Independent outcome settlement reports (Phase 3b).
 * ---------------------------------------------------------------------------
 * Phase 3a gave the protocol signed execution claims and coordinator
 * adjudications. Phase 3b makes BOTH independently checkable: any registered
 * verifier publishes an fbt.settlement-report.v1 that re-grades the outcome
 * from the same embedded evidence (selected commitment, claim, disputes,
 * adjudication) with the same deterministic rules the coordinator used.
 *
 * A settlement report answers what a completeness report cannot:
 *
 *   - what was PROMISED (the signed quote's amountOut and minOut);
 *   - what was DELIVERED (the signed claim's amountReceived);
 *   - the exact shortfall, in units and in basis points;
 *   - whether the coordinator's own adjudication agrees with the recomputed
 *     grade — a stored adjudication whose verdict does not reproduce is
 *     misconduct evidence, exactly like a censored receipt.
 *
 * The server re-evaluates every submitted report before storing it, so a
 * registered verifier can never store a verdict that does not recompute.
 * Like every other record in this protocol, the report never claims funds
 * moved: `custody: false`, `onChainTxVerified: false` are signed fields.
 */

import { createHash } from 'node:crypto';
import { blobConfigured } from './blobCache.js';
import {
  canonicalValue,
  signCanonicalPayload,
  verifyCanonicalSignature
} from './intentSignatures.js';
import { signedCommitmentHash } from './intentTransparency.js';
import { verifyAuctionClose } from './intentAuctions.js';
import {
  gradeExecution,
  minOutFor,
  verifyExecutionClaim
} from './intentExecution.js';
import { verifyDispute } from './intentDisputes.js';
import { verifyAdjudication } from './intentAdjudication.js';

export const SETTLEMENT_REPORT_SCHEMA = 'fbt.settlement-report.v1';
export const SETTLEMENT_DOMAIN = 'fbt.settlement-report.v1/signature';
export const SETTLEMENT_RECORD_SCHEMA = 'fbt.settlement-report-record.v1';
const REPORT_ID_DOMAIN = 'fbt.settlement-report.v1/id';
const TX_RE_64 = /^0x[a-fA-F0-9]{64}$/;
const ID_RE = /^[a-z0-9][a-z0-9._-]{1,47}$/;
const MAX_STORED_REPORTS_PER_INTENT = 64;
const TOKEN = process.env.BLOB_READ_WRITE_TOKEN || '';
const PREFIX = 'intent-auction/v1/';
const memory = new Map();
const pendingPaths = new Set();
let blobApi = null;

const sha256Hex = (value) => `0x${createHash('sha256').update(value).digest('hex')}`;

function shortfall(commitment, claim) {
  const promised = BigInt(String(commitment.amountOut));
  if (!claim?.amountReceived) return { shortfallUnits: '0', shortfallBps: 0 };
  const delivered = BigInt(String(claim.amountReceived));
  const units = delivered < promised ? promised - delivered : 0n;
  const bps = units > 0n ? Number((units * 10000n) / promised) : 0;
  return { shortfallUnits: units.toString(), shortfallBps: bps };
}

/**
 * THE SETTLEMENT EVALUATION. Pure function of embedded evidence + the
 * report's own evaluation time: every verifier, the FBT server and the
 * offline CLI derive identical verdicts, shortfall numbers and the
 * adjudication cross-check. `evaluatedAtSeconds` is the only clock input, so
 * a stored report always recomputes — pending windows can never drift into
 * evidence they did not contain.
 */
export function evaluateSettlement({
  close,
  commitment,
  claim = null,
  disputes = [],
  adjudication = null,
  evaluatedAtSeconds,
  graceSeconds
}) {
  if (!verifyAuctionClose(close)) return { ok: false, code: 'INVALID_AUCTION_CLOSE' };
  if (!commitment
    || signedCommitmentHash(commitment) !== String(close.decision?.selectedEntryHash).toLowerCase()) {
    return { ok: false, code: 'BAD_COMMITMENT_BINDING' };
  }
  if (!Number.isSafeInteger(evaluatedAtSeconds)
    || !Number.isInteger(graceSeconds) || graceSeconds < 0 || graceSeconds > 86400) {
    return { ok: false, code: 'BAD_EVALUATION_META' };
  }
  if (claim && !verifyExecutionClaim(claim, { close, commitment }).ok) {
    return { ok: false, code: 'BAD_EXECUTION_CLAIM' };
  }
  if (!Array.isArray(disputes) || disputes.some((dispute) => !verifyDispute(dispute, { close }).ok)) {
    return { ok: false, code: 'BAD_DISPUTE' };
  }
  if (adjudication && !verifyAdjudication(adjudication, { close }).ok) {
    return { ok: false, code: 'BAD_ADJUDICATION' };
  }

  const grade = gradeExecution({
    commitment,
    claim,
    disputes,
    nowSeconds: evaluatedAtSeconds,
    graceSeconds
  });
  if (!grade.ok) return { ok: false, code: grade.code };

  /* The coordinator's signed grade must reproduce from the same evidence.
     A mismatch is hard misconduct evidence: two signed statements — the
     adjudication and the recomputable rules — disagree. */
  const adjudicationConsistent = adjudication ? adjudication.verdict === grade.verdict : null;
  const verdict = adjudicationConsistent === false ? 'adjudication-mismatch' : grade.verdict;
  const difference = shortfall(commitment, claim);

  return {
    ok: true,
    verdict,
    adjudicationConsistent,
    penaltyBps: grade.penaltyBps,
    selfReported: grade.selfReported,
    quotedMinOut: minOutFor(commitment),
    promisedOut: commitment.amountOut,
    deliveredOut: claim?.amountReceived ?? null,
    ...difference,
    counts: {
      disputes: disputes.length,
      claimPresent: Boolean(claim),
      adjudicationPresent: Boolean(adjudication)
    }
  };
}

function reportIdFor(core) {
  return sha256Hex(`${REPORT_ID_DOMAIN}\n${JSON.stringify(canonicalValue(core))}`);
}

/**
 * Build a (signed) settlement report. `verifier` is the public identity;
 * `privateKey` produces a submittable signed report. The report embeds all
 * evidence it graded over, so third parties verify it without any registry.
 */
export function buildSettlementReport({
  close,
  commitment,
  claim = null,
  disputes = [],
  adjudication = null,
  verifier,
  privateKey = null,
  graceSeconds = 300,
  evaluatedAt = Date.now()
} = {}) {
  const evaluation = evaluateSettlement({
    close,
    commitment,
    claim,
    disputes,
    adjudication,
    evaluatedAtSeconds: Math.floor(evaluatedAt / 1000),
    graceSeconds
  });
  if (!evaluation.ok) return evaluation;
  if (!verifier
    || !ID_RE.test(String(verifier.id || ''))
    || typeof verifier.publicKey !== 'string'
    || !Number.isSafeInteger(evaluatedAt)) {
    return { ok: false, code: 'BAD_VERIFIER' };
  }
  const core = {
    schema: SETTLEMENT_REPORT_SCHEMA,
    intentHash: close.intentHash,
    closeId: close.closeId,
    entryHash: close.decision.selectedEntryHash,
    evaluatedAt,
    graceSeconds,
    verdict: evaluation.verdict,
    adjudicationConsistent: evaluation.adjudicationConsistent,
    penaltyBps: evaluation.penaltyBps,
    selfReported: evaluation.selfReported,
    quotedMinOut: evaluation.quotedMinOut,
    promisedOut: evaluation.promisedOut,
    deliveredOut: evaluation.deliveredOut,
    shortfallUnits: evaluation.shortfallUnits,
    shortfallBps: evaluation.shortfallBps,
    counts: evaluation.counts,
    input: {
      commitment,
      claim: claim || null,
      disputes: disputes || [],
      adjudication: adjudication || null
    },
    verifier: {
      id: verifier.id,
      name: String(verifier.name || verifier.id).replace(/[<>"'`\\]/g, '').slice(0, 80),
      publicKey: verifier.publicKey,
      algorithm: 'Ed25519'
    },
    claims: {
      closeSignatureVerified: true,
      claimSignatureVerified: claim ? true : null,
      disputeSignaturesVerified: true,
      adjudicationSignatureVerified: adjudication ? true : null,
      onChainTxVerified: false,
      observedEvidenceOnly: true,
      custody: false,
      fundsAccess: false
    }
  };
  const reportId = reportIdFor(core);
  const unsigned = { ...core, reportId };
  return {
    ok: true,
    report: {
      ...unsigned,
      signature: privateKey ? signCanonicalPayload(SETTLEMENT_DOMAIN, unsigned, privateKey) : null
    }
  };
}

/**
 * Full verification: recomputes the deterministic evaluation from the
 * embedded inputs BEFORE checking the signature, so a report whose verdict
 * or numbers do not reproduce is rejected even with a valid verifier key.
 * `registry` + `requireRegistered` pins the verifier to the active registry.
 */
export function verifySettlementReport(report, {
  close,
  registry = null,
  requireRegistered = false
} = {}) {
  if (!report
    || typeof report !== 'object'
    || Array.isArray(report)
    || report.schema !== SETTLEMENT_REPORT_SCHEMA
    || !TX_RE_64.test(String(report.reportId || ''))) {
    return { ok: false, code: 'BAD_REPORT_BODY' };
  }
  if (!close || !verifyAuctionClose(close)) return { ok: false, code: 'INVALID_AUCTION_CLOSE' };
  if (String(report.intentHash).toLowerCase() !== String(close.intentHash).toLowerCase()
    || String(report.closeId).toLowerCase() !== String(close.closeId).toLowerCase()) {
    return { ok: false, code: 'REPORT_CLOSE_MISMATCH' };
  }
  if (!Number.isSafeInteger(report.evaluatedAt)
    || !Number.isInteger(report.graceSeconds)
    || report.graceSeconds < 0
    || report.graceSeconds > 86400) {
    return { ok: false, code: 'BAD_EVALUATION_META' };
  }
  const verifier = report.verifier;
  if (!verifier || !ID_RE.test(String(verifier.id || '')) || verifier.algorithm !== 'Ed25519') {
    return { ok: false, code: 'BAD_VERIFIER' };
  }
  if (registry) {
    const row = registry.get(verifier.id);
    if (!row || !row.active || row.publicKey !== verifier.publicKey) {
      return { ok: false, code: requireRegistered ? 'UNREGISTERED_VERIFIER' : 'VERIFIER_NOT_IN_REGISTRY' };
    }
  } else if (requireRegistered) {
    return { ok: false, code: 'VERIFIER_REGISTRY_REQUIRED' };
  }

  const input = report.input || {};
  const recomputed = evaluateSettlement({
    close,
    commitment: input.commitment,
    claim: input.claim,
    disputes: Array.isArray(input.disputes) ? input.disputes : null,
    adjudication: input.adjudication,
    evaluatedAtSeconds: Math.floor(Number(report.evaluatedAt) / 1000),
    graceSeconds: report.graceSeconds
  });
  if (!recomputed.ok) return { ok: false, code: recomputed.code };
  if (report.verdict !== recomputed.verdict
    || report.adjudicationConsistent !== recomputed.adjudicationConsistent
    || report.penaltyBps !== recomputed.penaltyBps
    || report.selfReported !== recomputed.selfReported
    || report.quotedMinOut !== recomputed.quotedMinOut
    || report.promisedOut !== recomputed.promisedOut
    || report.deliveredOut !== recomputed.deliveredOut
    || report.shortfallUnits !== recomputed.shortfallUnits
    || report.shortfallBps !== recomputed.shortfallBps
    || JSON.stringify(canonicalValue(report.counts)) !== JSON.stringify(canonicalValue(recomputed.counts))) {
    return { ok: false, code: 'REPORT_RECOMPUTE_MISMATCH' };
  }
  const claims = report.claims;
  if (!claims
    || claims.onChainTxVerified !== false
    || claims.observedEvidenceOnly !== true
    || claims.custody !== false
    || claims.fundsAccess !== false) {
    return { ok: false, code: 'REPORT_CLAIMS_MISMATCH' };
  }
  const { signature, reportId, ...core } = report;
  if (reportIdFor(core) !== reportId) return { ok: false, code: 'BAD_REPORT_ID' };
  if (!verifyCanonicalSignature(SETTLEMENT_DOMAIN, { ...core, reportId }, signature, verifier.publicKey)) {
    return { ok: false, code: 'VERIFIER_SIGNATURE_MISMATCH' };
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

const reportDir = (intentHash) => `${PREFIX}settlement/${String(intentHash).slice(2)}/`;
const reportPath = (intentHash, verifierId, reportId) =>
  `${reportDir(intentHash)}${verifierId}/${String(reportId).slice(2)}.json`;

export async function storeSettlementReport(intentHash, report) {
  const intent = TX_RE_64.test(String(intentHash || '')) ? String(intentHash).toLowerCase() : null;
  if (!intent
    || !TX_RE_64.test(String(report?.reportId || ''))
    || !ID_RE.test(String(report?.verifier?.id || ''))) {
    return { ok: false, code: 'BAD_REPORT_BODY' };
  }
  const path = reportPath(intent, report.verifier.id, report.reportId);
  const asDuplicate = async () => {
    try {
      const found = (await listRecords(intent)).find((item) => item.path === path);
      return found
        ? { ok: true, alreadyReported: true, record: found }
        : { ok: false, code: 'SETTLEMENT_STORE_UNAVAILABLE' };
    } catch {
      return { ok: false, code: 'SETTLEMENT_STORE_UNAVAILABLE' };
    }
  };
  if (memory.has(path) || pendingPaths.has(path)) return asDuplicate();
  pendingPaths.add(path);
  try {
    const existingCount = await countStoredReports(intent);
    if (existingCount == null) return { ok: false, code: 'SETTLEMENT_STORE_UNAVAILABLE' };
    if (existingCount >= MAX_STORED_REPORTS_PER_INTENT) return { ok: false, code: 'SETTLEMENT_REPORTS_FULL' };

    const record = { schema: SETTLEMENT_RECORD_SCHEMA, path, storedAt: Date.now(), report };
    const mod = await blob();
    if (blobConfigured() && !mod) return { ok: false, code: 'SETTLEMENT_STORE_UNAVAILABLE' };
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
        return duplicate.ok ? duplicate : { ok: false, code: 'SETTLEMENT_WRITE_FAILED' };
      }
    }
    memory.set(path, record);
    return { ok: true, alreadyReported: false, record };
  } finally {
    pendingPaths.delete(path);
  }
}

async function listRecords(intentHash) {
  const rows = [...memory.entries()]
    .filter(([key]) => key.startsWith(reportDir(intentHash)))
    .map(([, record]) => record);
  if (!blobConfigured()) return rows;
  const mod = await blob();
  if (!mod) throw new Error('SETTLEMENT_STORE_UNAVAILABLE');
  const blobs = [];
  let cursor;
  let guard = 0;
  do {
    const page = await mod.list({ prefix: reportDir(intentHash), limit: 1000, cursor, token: TOKEN });
    blobs.push(...(page?.blobs || []));
    guard += page?.blobs?.length || 0;
    if (guard > MAX_STORED_REPORTS_PER_INTENT * 4) throw new Error('SETTLEMENT_STORE_TOO_LARGE');
    if (page?.hasMore && !page.cursor) throw new Error('SETTLEMENT_STORE_CURSOR_MISSING');
    cursor = page?.hasMore ? page.cursor : undefined;
  } while (cursor);

  const remote = await Promise.all(blobs.map(async (item) => {
    const response = await fetch(item.url, { cache: 'no-store' });
    if (!response.ok) throw new Error('SETTLEMENT_OBJECT_UNREADABLE');
    const record = await response.json();
    if (record?.schema !== SETTLEMENT_RECORD_SCHEMA || record.path !== item.pathname) {
      throw new Error('INVALID_STORED_SETTLEMENT_REPORT');
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

/** Read every stored report for an intent and re-verify it against the given
    close. Registry membership is intentionally NOT re-checked on read — a
    legitimate verifier rotation must not erase historical evidence. */
export async function readSettlementReports(intentHash, close) {
  const intent = TX_RE_64.test(String(intentHash || '')) ? String(intentHash).toLowerCase() : null;
  if (!intent) return { error: 'BAD_INTENT_HASH' };
  try {
    const records = await listRecords(intent);
    const verified = [];
    for (const record of records) {
      const check = verifySettlementReport(record.report, { close });
      if (!check.ok) return { error: 'INVALID_STORED_SETTLEMENT_REPORT' };
      verified.push(record);
    }
    verified.sort((a, b) => String(a.report?.reportId).localeCompare(String(b.report?.reportId)));
    return { reports: verified };
  } catch {
    return { error: 'SETTLEMENT_STORE_UNAVAILABLE' };
  }
}

/** Public projection of a stored settlement report: no storage internals. */
export function publicSettlementReport(record) {
  const report = record?.report || {};
  return {
    reportId: report.reportId,
    verdict: report.verdict,
    adjudicationConsistent: report.adjudicationConsistent,
    evaluatedAt: report.evaluatedAt,
    promisedOut: report.promisedOut,
    deliveredOut: report.deliveredOut,
    shortfallUnits: report.shortfallUnits,
    shortfallBps: report.shortfallBps,
    counts: report.counts,
    verifier: report.verifier ? {
      id: report.verifier.id,
      name: report.verifier.name,
      publicKey: report.verifier.publicKey,
      algorithm: 'Ed25519'
    } : null
  };
}

/**
 * Derive the live per-auction settlement status from verified reports.
 * Conservative by design: an adjudication mismatch wins (it is misconduct
 * evidence against the coordinator), any adverse verdict dominates
 * 'fulfilled', 'pending' dominates nothing, and zero reports stay
 * 'unmonitored' — never implicitly settled.
 */
export function settlementSummary(records = []) {
  const reports = records.map((record) => record?.report || record).filter(Boolean);
  const verdicts = {};
  let latestEvaluatedAt = null;
  const verifiers = new Set();
  let delivered = null;
  let promised = null;
  for (const report of reports) {
    verdicts[report.verdict] = (verdicts[report.verdict] || 0) + 1;
    if (report.verifier?.id) verifiers.add(report.verifier.id);
    if (Number.isSafeInteger(report.evaluatedAt)) {
      latestEvaluatedAt = Math.max(latestEvaluatedAt ?? 0, report.evaluatedAt);
    }
    if (report.deliveredOut != null) delivered = report.deliveredOut;
    if (report.promisedOut != null) promised = report.promisedOut;
  }
  let status = 'unmonitored';
  if (verdicts['adjudication-mismatch'] > 0) status = 'adjudication-mismatch';
  else if ((verdicts['short-filled'] || 0) + (verdicts.failed || 0)
    + (verdicts.unexecuted || 0) + (verdicts.contested || 0) > 0) status = 'adverse';
  else if (verdicts.pending > 0) status = 'pending';
  else if (verdicts.fulfilled > 0) status = 'fulfilled';
  return {
    status,
    reports: reports.length,
    verifiers: [...verifiers].sort(),
    verdicts,
    latestEvaluatedAt,
    promisedOut: promised,
    deliveredOut: delivered,
    /* Settlement is claimed only for the evidence verifiers actually
       observed; the universe of unobserved executions is unknown. */
    scope: 'observed-evidence-only'
  };
}

/** Capabilities block. Booleans of real configuration only. */
export function settlementProtocolStatus({ registeredVerifiers = 0, graceSeconds = null } = {}) {
  return {
    reportSchema: SETTLEMENT_REPORT_SCHEMA,
    registeredVerifiers,
    graceSeconds,
    serverRecomputesBeforeStorage: true,
    adjudicationCrossCheck: true,
    offlineVerifier: 'scripts/intent-settler.mjs',
    submissionEndpoint: '/api/intents/v1/auctions/{intentHash}/settlement-reports',
    onChainTxVerification: false,
    custody: false
  };
}
