/** Independent evidence gate. Agent prose and self-reported success are not receipts. */
import { createHash } from 'node:crypto';
import { newId, MissionError } from './store.js';

const digest = (text) => createHash('sha256').update(text).digest('hex');
export function toolReceipt({ source, sourceUrl = null, raw, receivedAt = Date.now(), observedAt = null, ttlMs = 300000, producer, txRef = null }) {
  if (!source || !producer || raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new MissionError('INVALID_TOOL_RECEIPT');
  if (!['live', 'observed', 'partial'].includes(raw.dataStatus)) throw new MissionError(raw.dataStatus === 'unavailable' ? 'SOURCE_UNAVAILABLE' : 'TOOL_NOT_OBSERVED');
  const rawJson = JSON.stringify(raw);
  if (Buffer.byteLength(rawJson) > 262144) throw new MissionError('EVIDENCE_TOO_LARGE');
  if (!Number.isFinite(receivedAt) || receivedAt > Date.now() + 60000 || !Number.isFinite(ttlMs) || ttlMs <= 0) throw new MissionError('INVALID_RECEIPT_TIME');
  let safeUrl = null;
  if (sourceUrl) {
    const u = new URL(sourceUrl);
    if (u.protocol !== 'https:' || u.username || u.password) throw new MissionError('INVALID_SOURCE_URL');
    for (const key of [...u.searchParams.keys()]) if (/key|token|secret|password|signature/i.test(key)) u.searchParams.set(key, 'redacted');
    safeUrl = u.toString();
  }
  return {
    id: newId('ev'), source: String(source).slice(0, 120), sourceUrl: safeUrl,
    receivedAt, observedAt: Number.isFinite(observedAt) ? observedAt : receivedAt,
    expiresAt: receivedAt + Math.min(ttlMs, 86400000), rawJson, rawSha256: digest(rawJson),
    origin: txRef ? 'execution' : 'tool', producer, status: 'pending', verification: null, txRef
  };
}
export function verifyReceipt(input, { now = Date.now(), inspectRaw, verifyTransaction = null } = {}) {
  const receipt = input ? { ...input, raw_json: input.raw_json ?? input.rawJson, raw_sha256: input.raw_sha256 ?? input.rawSha256, received_at: input.received_at ?? input.receivedAt, expires_at: input.expires_at ?? input.expiresAt, tx_ref: input.tx_ref ?? input.txRef } : input;
  const fail = (code) => ({ ok: false, code, verifiedAt: now, verifier: 'mission-evidence-v1' });
  if (!receipt || receipt.origin !== 'tool' && receipt.origin !== 'execution') return fail('AGENT_CLAIM_NOT_EVIDENCE');
  if (!receipt.source || !receipt.producer || !receipt.raw_sha256) return fail('PROVENANCE_REQUIRED');
  if (digest(receipt.raw_json) !== receipt.raw_sha256) return fail('DIGEST_MISMATCH');
  if (!Number.isFinite(receipt.received_at) || receipt.received_at > now + 60000 || receipt.expires_at <= now) return fail('STALE_OR_INVALID_TIME');
  let raw;
  try { raw = JSON.parse(receipt.raw_json); } catch { return fail('INVALID_RAW_DATA'); }
  if (!raw || typeof raw !== 'object' || !['live', 'observed', 'partial'].includes(raw.dataStatus)) return fail('NO_OBSERVATION');
  if (typeof inspectRaw !== 'function') return fail('INDEPENDENT_VERIFIER_MISSING');
  let inspection;
  try { inspection = inspectRaw(raw, receipt); } catch { return fail('VERIFIER_FAILED'); }
  if (inspection?.ok !== true) return fail(inspection?.code || 'RAW_DATA_REJECTED');
  if (receipt.origin === 'execution') {
    if (!verifyTransaction || !receipt.tx_ref?.txHash || !receipt.tx_ref?.chain) return fail('CHAIN_RECEIPT_REQUIRED');
    let verified;
    try { verified = verifyTransaction(receipt.tx_ref, raw); } catch { return fail('CHAIN_VERIFICATION_FAILED'); }
    if (verified?.ok !== true || verified.confirmed !== true || verified.txHash !== receipt.tx_ref.txHash) return fail('TRANSACTION_NOT_CONFIRMED');
  }
  return { ok: true, code: 'VERIFIED', verifiedAt: now, verifier: 'mission-evidence-v1', partial: raw.dataStatus === 'partial', checks: ['digest', 'provenance', 'freshness', 'independent-raw-inspection', ...(receipt.origin === 'execution' ? ['chain-receipt'] : [])] };
}
/** Completion is a transaction guarded by evidence, never by a model sentence. */
export function assertMissionCanComplete(store, missionId) {
  const m = store.mission(missionId);
  const tasks = store.tasksFor(missionId);
  const judge = tasks.find((t) => t.agent_id === 'final_judge');
  if (!tasks.length || !judge || judge.status !== 'completed') throw new MissionError('JUDGE_NOT_COMPLETED');
  for (const task of tasks) {
    if (task.status !== 'completed') throw new MissionError('TASK_NOT_COMPLETED');
    const evidence = store.evidenceFor(task.evidence_id);
    if (task.agent_id === 'final_judge') {
      if (!task.output?.evidenceIds?.length || task.output?.decision !== 'ANSWER') throw new MissionError('JUDGE_ABSTAINED');
      for (const id of task.output.evidenceIds) if (store.evidenceFor(id)?.status !== 'verified') throw new MissionError('EVIDENCE_NOT_VERIFIED');
    } else if (!evidence || evidence.status !== 'verified') throw new MissionError('EVIDENCE_NOT_VERIFIED');
  }
  if (m.kind === 'trade_request') throw new MissionError(' WALLET_SIGNATURE_REQUIRED'.trim());
  return true;
}
