#!/usr/bin/env node
/**
 * Independent completeness watchtower CLI (Phase 2c).
 *
 * This tool needs no FBT server code execution trust: everything it checks is
 * Ed25519 signatures plus one deterministic evaluation rule set. Given the
 * same signed close and the same admission receipts, every copy of this tool
 * on every machine derives the same classifications, counts and verdict.
 *
 *   # Check one coordinator-signed admission receipt offline:
 *   node scripts/intent-watchtower.mjs verify-receipt receipt.json
 *
 *   # Evaluate observed receipts against a signed close (offline verdict):
 *   node scripts/intent-watchtower.mjs verify close.json receipts.json
 *
 *   # Sign a submittable completeness report as an independent watcher:
 *   INTENT_WATCHER_PRIVATE_KEY='…' INTENT_WATCHER_ID='watch-coop' \
 *     node scripts/intent-watchtower.mjs report close.json receipts.json > report.json
 *   curl -X POST "$FBT_URL/api/intents/v1/auctions/$INTENT_HASH/watcher-reports" \
 *     -H 'content-type: application/json' --data-binary @report.json
 *
 *   # Verify a stored (or received) watcher report offline:
 *   node scripts/intent-watchtower.mjs verify-report report.json close.json
 *
 *   # Convenience: download the close and derive receipts for every logged
 *   # entry from the public endpoints. Evidence quality note: receipts pulled
 *   # from the admissions endpoint are server-DERIVED; the strongest evidence
 *   # is the receipt a solver captured at its own 201 response time. Deriving
 *   # is useful for audits and for reclaiming lost responses.
 *   node scripts/intent-watchtower.mjs collect https://your-fbt-host $INTENT_HASH out.json
 *
 * The watcher private key signs reports only — it never touches user funds —
 * and it must stay in the watcher's own secrets manager, never in VITE_*,
 * the repository, an issue, or a chat.
 */

import fs from 'node:fs';
import { verifyAdmissionReceipt } from '../server/intentAdmissions.js';
import { verifyAuctionClose } from '../server/intentAuctions.js';
import {
  buildCompletenessReport,
  evaluateCompleteness,
  verifyCompletenessReport,
  watcherConfigFromPrivateKey
} from '../server/intentWatcher.js';

const [, , command, arg1, arg2, arg3] = process.argv;

const fail = (message, code = 2) => {
  console.error(message);
  process.exit(code);
};

const readJson = (file, label) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { fail(`Cannot read ${label}: ${error.message}`); }
};

const readReceipts = (file) => {
  const value = readJson(file, 'receipts');
  const receipts = Array.isArray(value) ? value : value?.receipts;
  if (!Array.isArray(receipts)) fail('Receipt file must be a JSON array or {"receipts": [...]}.');
  return receipts;
};

const usage = () => {
  console.error('Usage:');
  console.error('  intent-watchtower.mjs verify-receipt <receipt.json>');
  console.error('  intent-watchtower.mjs verify <close.json> <receipts.json>');
  console.error('  intent-watchtower.mjs report <close.json> <receipts.json>');
  console.error('  intent-watchtower.mjs verify-report <report.json> <close.json>');
  console.error('  intent-watchtower.mjs collect <baseUrl> <intentHash> [out.json]');
  process.exit(2);
};

if (command === 'verify-receipt' && arg1 && !arg2) {
  const receipt = readJson(arg1, 'admission receipt');
  if (!verifyAdmissionReceipt(receipt)) fail('INVALID_ADMISSION_RECEIPT', 1);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    receiptId: receipt.receiptId,
    intentHash: receipt.intentHash,
    entryHash: receipt.entryHash,
    acceptedAt: receipt.acceptedAt,
    solverId: receipt.solverId,
    coordinator: receipt.coordinator,
    claims: receipt.claims
  }, null, 2)}\n`);
  process.exit(0);
}

if (command === 'verify' && arg1 && arg2 && !arg3) {
  const close = readJson(arg1, 'close receipt');
  if (!verifyAuctionClose(close)) fail('INVALID_AUCTION_CLOSE', 1);
  const result = evaluateCompleteness(close, readReceipts(arg2));
  if (!result.ok) fail(result.code, 1);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    closeId: close.closeId,
    intentHash: close.intentHash,
    clockSkewAllowanceMs: result.clockSkewMs,
    verdict: result.verdict,
    counts: result.counts,
    rows: result.rows.map((row) => ({
      classification: row.classification,
      receiptId: row.receiptId,
      entryHash: row.entryHash,
      solverId: row.solverId,
      acceptedAt: row.acceptedAt
    }))
  }, null, 2)}\n`);
  process.exit(0);
}

if (command === 'report' && arg1 && arg2 && !arg3) {
  const close = readJson(arg1, 'close receipt');
  if (!verifyAuctionClose(close)) fail('INVALID_AUCTION_CLOSE', 1);
  const watcher = watcherConfigFromPrivateKey();
  if (!watcher) {
    fail('INTENT_WATCHER_PRIVATE_KEY is required (optionally INTENT_WATCHER_ID / INTENT_WATCHER_NAME).');
  }
  const built = buildCompletenessReport({
    close,
    receipts: readReceipts(arg2),
    watcher,
    privateKey: watcher.privateKey
  });
  if (!built.ok) fail(built.code, 1);
  process.stdout.write(`${JSON.stringify(built.report, null, 2)}\n`);
  process.exit(0);
}

if (command === 'verify-report' && arg1 && arg2 && !arg3) {
  const report = readJson(arg1, 'completeness report');
  const close = readJson(arg2, 'close receipt');
  /* No registry on purpose: third parties verify against the report's pinned
     watcher key. Submission-time registry checks are the server's concern. */
  const checked = verifyCompletenessReport(report, { close });
  if (!checked.ok) fail(checked.code, 1);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    reportId: report.reportId,
    closeId: report.closeId,
    intentHash: report.intentHash,
    verdict: report.verdict,
    counts: report.counts,
    watcher: report.watcher,
    evaluatedAt: report.evaluatedAt
  }, null, 2)}\n`);
  process.exit(0);
}

if (command === 'collect' && arg1 && arg2) {
  const base = String(arg1).replace(/\/$/, '');
  const intentHash = String(arg2).toLowerCase();
  if (!/^https?:\/\//.test(base)) fail('baseUrl must be an http(s) URL.', 2);
  if (!/^0x[a-f0-9]{64}$/.test(intentHash)) fail('BAD_INTENT_HASH', 2);
  const get = async (path) => {
    const response = await fetch(`${base}${path}`, { headers: { accept: 'application/json' } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) fail(`GET ${path} → ${response.status}: ${body?.error || 'failed'}`, 1);
    return body;
  };
  const state = await get(`/api/intents/v1/auctions/${intentHash}`);
  if (!state.close) fail('AUCTION_NOT_CLOSED', 1);
  const log = await get(`/api/intents/v1/log/${intentHash}`);
  const receipts = [];
  for (const entry of log.entries || []) {
    receipts.push(await get(`/api/intents/v1/admissions/${intentHash}/${entry.entryHash}`));
  }
  const evidence = {
    collectedAt: Date.now(),
    baseUrl: base,
    evidenceQuality: receipts.length
      ? 'server-derived-receipts (weaker than solver-captured receipts)'
      : 'no-admissions-logged',
    close: state.close,
    receipts
  };
  const json = `${JSON.stringify(evidence, null, 2)}\n`;
  if (arg3) fs.writeFileSync(arg3, json);
  else process.stdout.write(json);
  process.exit(0);
}

usage();
