/**
 * FBT FUTURES — execution store + immutable fee revenue ledger (spec §7, §16, §17).
 * ---------------------------------------------------------------------------
 * Persists through the same key-value store the rest of the API owns
 * (server/store.js: Upstash/Blob when configured, in-process Map otherwise —
 * `storeDurable()` says which, and the API reports it, so nobody mistakes a
 * preview deployment's memory for an accounting system).
 *
 * Entities (spec §22), keyed per record:
 *   futures_executions   fut_exec_*  — request/intent/execution ids, provider,
 *                        market, side, sizes, fee breakdown, state history, txHash
 *   futures_fee_records  fee_*       — APPEND-ONLY. A record is written once
 *                        when an execution is prepared (status PREPARED) and a
 *                        SECOND record is appended when it is verified on-chain
 *                        (status CONFIRMED / REVERTED). Records are never
 *                        mutated; reconciliation reads the latest per execution.
 *   futures_orders       (client-side / venue-side) — not stored here
 *
 * Nothing in a record is secret: no keys, no signatures, no calldata beyond a
 * hash of it (so a replay can be matched without storing the payload).
 */
import { createHash, randomUUID } from 'node:crypto';
import { storeGet, storeSet, storeDurable } from '../store.js';
import { validateFeeBreakdown } from '../../src/lib/futures-engine/fees.js';

const EXEC_INDEX_KEY = 'futures:exec:index:v1';
const FEE_INDEX_KEY = 'futures:fees:index:v1';
const MAX_INDEX = 5000;

const execKey = (id) => `futures:exec:v1:${id}`;
const feeKey = (id) => `futures:fee:v1:${id}`;
const walletKey = (w) => `futures:wallet:v1:${String(w || '').toLowerCase()}`;
const idemKey = (owner, k) => `futures:idem:v1:${createHash('sha256').update(`${String(owner || 'anon').toLowerCase()}|${k}`).digest('hex').slice(0, 40)}`;

export const calldataHash = (data) => (data ? `0x${createHash('sha256').update(String(data)).digest('hex').slice(0, 32)}` : null);

/* ── idempotency (server side) ───────────────────────────────────────────── */

export async function claimFuturesIdempotency({ owner, key, fingerprint }) {
  const k = idemKey(owner, key);
  const existing = await storeGet(k, null);
  if (existing) {
    return existing.fingerprint === fingerprint
      ? { ok: true, replay: true, result: existing.result }
      : { ok: false, code: 'IDEMPOTENCY_CONFLICT' };
  }
  return { ok: true, replay: false, storageKey: k, fingerprint };
}
export async function saveFuturesIdempotency(claim, result) {
  if (!claim?.storageKey) return;
  await storeSet(claim.storageKey, { fingerprint: claim.fingerprint, result, at: Date.now() });
}

/* ── executions ──────────────────────────────────────────────────────────── */

async function pushIndex(indexKey, id) {
  const rows = await storeGet(indexKey, []);
  const next = Array.isArray(rows) ? rows : [];
  next.push(id);
  if (next.length > MAX_INDEX) next.splice(0, next.length - MAX_INDEX);
  await storeSet(indexKey, next);
}

async function pushWalletIndex(wallet, executionId) {
  if (!wallet) return;
  const k = walletKey(wallet);
  const rows = await storeGet(k, []);
  const next = Array.isArray(rows) ? rows : [];
  if (!next.includes(executionId)) next.unshift(executionId);
  await storeSet(k, next.slice(0, 200));
}

export async function createExecution({ requestId, intentId = null, idempotencyKey = null, owner = null, wallet, providerId, marketId, symbol, action, side, collateralUsd, leverage, notionalUsd, fee, risk, route, unsignedTx, positionId = null }) {
  const executionId = `fut_exec_${randomUUID()}`;
  const now = Date.now();
  const record = {
    schema: 'fbt.futures-execution.v1',
    executionId, requestId: requestId || null, intentId, idempotencyKey,
    owner: owner ? createHash('sha256').update(String(owner)).digest('hex').slice(0, 24) : null,
    wallet: String(wallet || '').toLowerCase(), providerId, marketId, symbol, action, side, positionId,
    collateralUsd: collateralUsd ?? null, leverage: leverage ?? null, notionalUsd: notionalUsd ?? null,
    fee: fee || null, risk: risk ? { riskScore: risk.riskScore, riskLevel: risk.riskLevel, blocked: risk.blocked, warnings: risk.warnings } : null,
    route: route ? { providerId: route.providerId, reasons: route.reasons, rejected: route.rejected } : null,
    tx: unsignedTx ? { to: unsignedTx.to, chainId: unsignedTx.chainId, calldataHash: calldataHash(unsignedTx.data), value: unsignedTx.value || '0x0' } : null,
    state: 'PREPARED',
    history: [{ state: 'PREPARED', at: now }],
    txHash: null, verification: null,
    createdAt: now, updatedAt: now
  };
  await storeSet(execKey(executionId), record);
  await pushIndex(EXEC_INDEX_KEY, executionId);
  await pushWalletIndex(record.wallet, executionId);
  return record;
}

export async function getExecution(executionId) {
  if (!/^fut_exec_[0-9a-f-]{36}$/.test(String(executionId || ''))) return null;
  return storeGet(execKey(executionId), null);
}

export async function updateExecution(executionId, patch = {}, state = null) {
  const record = await getExecution(executionId);
  if (!record) return null;
  const now = Date.now();
  const next = { ...record, ...patch, updatedAt: now };
  if (state && state !== record.state) {
    next.state = state;
    next.history = [...(record.history || []), { state, at: now }];
  }
  await storeSet(execKey(executionId), next);
  return next;
}

export async function listExecutionsForWallet(wallet, { limit = 50 } = {}) {
  const ids = await storeGet(walletKey(wallet), []);
  const rows = [];
  for (const id of (Array.isArray(ids) ? ids : []).slice(0, limit)) {
    const r = await storeGet(execKey(id), null);
    if (r) rows.push(r);
  }
  return rows;
}

/* ── fee records (append-only) ───────────────────────────────────────────── */

export async function appendFeeRecord({ executionId, requestId = null, intentId = null, wallet, providerId, marketId, action, fee, status, txHash = null, chainId = null, note = null }) {
  const v = validateFeeBreakdown(fee);
  if (!v.ok) return { ok: false, code: 'FEE_INVALID', problems: v.problems };
  const feeRecordId = `fee_${randomUUID()}`;
  const record = Object.freeze({
    schema: 'fbt.futures-fee-record.v1',
    feeRecordId, executionId, requestId, intentId,
    wallet: String(wallet || '').toLowerCase(), providerId, marketId, action,
    status, // PREPARED | CONFIRMED | REVERTED | CANCELLED
    txHash, chainId,
    notionalUsd: fee.notionalUsd,
    fbtBps: fee.fbt.bps, fbtPolicyId: fee.fbt.policyId, fbtFeeUsd: fee.fbt.feeUsd, fbtRecipient: fee.fbt.recipient, fbtChargedOn: fee.fbt.chargedOn,
    protocolFeeUsd: fee.protocol.feeUsd, networkFeeUsd: fee.network.feeUsd, totalFeeUsd: fee.totalFeeUsd,
    note, at: Date.now()
  });
  await storeSet(feeKey(feeRecordId), record);
  await pushIndex(FEE_INDEX_KEY, feeRecordId);
  return { ok: true, record };
}

export async function listFeeRecords({ limit = 100, wallet = null, executionId = null } = {}) {
  const ids = await storeGet(FEE_INDEX_KEY, []);
  const rows = [];
  for (const id of (Array.isArray(ids) ? ids : []).slice().reverse()) {
    const r = await storeGet(feeKey(id), null);
    if (!r) continue;
    if (wallet && r.wallet !== String(wallet).toLowerCase()) continue;
    if (executionId && r.executionId !== executionId) continue;
    rows.push(r);
    if (rows.length >= limit) break;
  }
  return rows;
}

/** Revenue summary — only CONFIRMED records count as earned. */
export async function feeSummary() {
  const rows = await listFeeRecords({ limit: MAX_INDEX });
  const sum = (status) => rows.filter((r) => r.status === status).reduce((s, r) => s + (Number(r.fbtFeeUsd) || 0), 0);
  return {
    durable: storeDurable(),
    records: rows.length,
    confirmedFbtFeeUsd: Number(sum('CONFIRMED').toFixed(6)),
    preparedFbtFeeUsd: Number(sum('PREPARED').toFixed(6)),
    revertedCount: rows.filter((r) => r.status === 'REVERTED').length,
    byProvider: rows.reduce((acc, r) => { if (r.status === 'CONFIRMED') acc[r.providerId] = Number(((acc[r.providerId] || 0) + (Number(r.fbtFeeUsd) || 0)).toFixed(6)); return acc; }, {})
  };
}

export const ledgerDurable = () => storeDurable();
