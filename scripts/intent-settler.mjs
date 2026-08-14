#!/usr/bin/env node
/**
 * Independent outcome-settlement CLI (Phase 3b).
 *
 * This tool needs no FBT server trust: everything it checks is Ed25519
 * signatures plus the shared deterministic grading engine. Given the same
 * signed close, selected commitment, claim, disputes and adjudication, every
 * copy of this tool on every machine derives the same verdict, shortfall and
 * adjudication cross-check.
 *
 *   # The signed quote's own minimum output:
 *   node scripts/intent-settler.mjs min-out commitment.json
 *
 *   # Sign an execution claim as the winning solver (private key never printed):
 *   INTENT_SOLVER_PRIVATE_KEY='…' INTENT_SOLVER_ID='mm-a' \
 *     node scripts/intent-settler.mjs claim close.json commitment.json \
 *     --outcome filled --tx 0x… --received 400000000000000000 --fee 70 --executed-at 1710000000
 *
 *   # Sign a dispute as an independent verifier (private key never printed):
 *   INTENT_VERIFIER_PRIVATE_KEY='…' INTENT_VERIFIER_ID='verify-coop' \
 *     node scripts/intent-settler.mjs dispute close.json --kind no-execution --detail 'no tx observed'
 *
 *   # Verify a solver's execution claim offline:
 *   node scripts/intent-settler.mjs verify-claim claim.json close.json commitment.json
 *
 *   # Offline grade of one sealed outcome:
 *   node scripts/intent-settler.mjs grade close.json commitment.json \
 *     --claim claim.json --disputes disputes.json --adjudication adjudication.json
 *
 *   # Sign a submittable settlement report as an independent verifier:
 *   INTENT_VERIFIER_PRIVATE_KEY='…' INTENT_VERIFIER_ID='verify-coop' \
 *     node scripts/intent-settler.mjs report close.json commitment.json \
 *     --claim claim.json --adjudication adjudication.json > report.json
 *   curl -X POST "$FBT_URL/api/intents/v1/auctions/$INTENT_HASH/settlement-reports" \
 *     -H 'content-type: application/json' --data-binary @report.json
 *
 *   # Verify a stored (or received) settlement report offline:
 *   node scripts/intent-settler.mjs verify-report report.json close.json
 *
 *   # Convenience: download the close, claim, disputes, adjudication and
 *   # settlement reports from the public endpoints.
 *   node scripts/intent-settler.mjs collect https://your-fbt-host $INTENT_HASH out.json
 *
 * The verifier private key signs settlement reports only — it never touches
 * user funds — and it must stay in the verifier's own secrets manager, never
 * in VITE_*, the repository, an issue, or a chat.
 */

import fs from 'node:fs';
import { verifyAuctionClose } from '../server/intentAuctions.js';
import {
  buildExecutionClaim,
  minOutFor,
  solverConfigFromPrivateKey,
  verifyExecutionClaim
} from '../server/intentExecution.js';
import {
  buildDispute,
  verifyDispute,
  verifierConfigFromPrivateKey
} from '../server/intentDisputes.js';
import {
  buildSettlementReport,
  evaluateSettlement,
  verifySettlementReport
} from '../server/intentSettlement.js';

const fail = (message, code = 2) => {
  console.error(message);
  process.exit(code);
};

const readJson = (file, label) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { fail(`Cannot read ${label}: ${error.message}`); }
};

const readDisputes = (file) => {
  const value = readJson(file, 'disputes');
  const disputes = Array.isArray(value) ? value : value?.disputes;
  if (!Array.isArray(disputes)) fail('Disputes file must be a JSON array or {"disputes": [...]}.');
  return disputes;
};

const FLAG_KEYS = new Set([
  'claim', 'disputes', 'adjudication', 'grace',
  'outcome', 'tx', 'received', 'fee', 'gas', 'executed-at',
  'kind', 'detail', 'observed-at'
]);

/** Minimal flag parser: positionals, then --key value pairs from FLAG_KEYS. */
const parseArgs = (args) => {
  const out = { positional: [] };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith('--')) {
      out.positional.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = args[i + 1];
    if (!FLAG_KEYS.has(key) || !next || next.startsWith('--')) {
      fail(`Missing value for ${arg}.`);
    }
    out[key] = next;
    i += 1;
  }
  return out;
};

const [, , command, ...args] = process.argv;

const usage = () => {
  console.error('Usage:');
  console.error('  intent-settler.mjs min-out <commitment.json>');
  console.error('  intent-settler.mjs claim <close.json> <commitment.json> --outcome filled|short|reverted|expired [--tx <hash>] [--received <n>] [--fee <bps>] [--gas <wei>] [--executed-at <unix>]');
  console.error('  intent-settler.mjs dispute <close.json> --kind no-execution|short-fill|false-claim|late-execution [--detail <text>] [--observed-at <unix>]');
  console.error('  intent-settler.mjs verify-claim <claim.json> <close.json> <commitment.json>');
  console.error('  intent-settler.mjs grade <close.json> <commitment.json> [--claim <f>] [--disputes <f>] [--adjudication <f>] [--grace <s>]');
  console.error('  intent-settler.mjs report <close.json> <commitment.json> [--claim <f>] [--disputes <f>] [--adjudication <f>] [--grace <s>]');
  console.error('  intent-settler.mjs verify-report <report.json> <close.json>');
  console.error('  intent-settler.mjs collect <baseUrl> <intentHash> [out.json]');
  process.exit(2);
};

const loadInputs = (args) => {
  const parsed = parseArgs(args);
  if (parsed.positional.length < 2) usage();
  const [closeFile, commitmentFile] = parsed.positional;
  const close = readJson(closeFile, 'close receipt');
  if (!verifyAuctionClose(close)) fail('INVALID_AUCTION_CLOSE', 1);
  const commitment = readJson(commitmentFile, 'commitment');
  const claim = parsed.claim ? readJson(parsed.claim, 'claim') : null;
  const disputes = parsed.disputes ? readDisputes(parsed.disputes) : [];
  const adjudication = parsed.adjudication ? readJson(parsed.adjudication, 'adjudication') : null;
  const grace = parsed.grace != null ? Number(parsed.grace) : 300;
  if (!Number.isInteger(grace) || grace < 0 || grace > 86400) fail('--grace must be an integer 0-86400.');
  return { close, commitment, claim, disputes, adjudication, grace };
};

if (command === 'min-out' && args.length === 1) {
  const commitment = readJson(args[0], 'commitment');
  const minOut = minOutFor(commitment);
  if (minOut == null) fail('BAD_COMMITMENT', 1);
  process.stdout.write(`${JSON.stringify({
    amountOut: commitment.amountOut,
    slippageBps: commitment.slippageBps,
    quotedMinOut: minOut
  }, null, 2)}\n`);
  process.exit(0);
}

if (command === 'claim' && args.length >= 2) {
  const parsed = parseArgs(args);
  if (parsed.positional.length < 2) usage();
  const [closeFile, commitmentFile] = parsed.positional;
  const close = readJson(closeFile, 'close receipt');
  if (!verifyAuctionClose(close)) fail('INVALID_AUCTION_CLOSE', 1);
  const commitment = readJson(commitmentFile, 'commitment');
  const solver = solverConfigFromPrivateKey();
  if (!solver) {
    fail('INTENT_SOLVER_PRIVATE_KEY is required (optionally INTENT_SOLVER_ID / INTENT_SOLVER_NAME).');
  }
  const outcome = parsed.outcome;
  if (!outcome) fail('--outcome filled|short|reverted|expired is required.');
  const executedAt = parsed['executed-at'] != null
    ? Number(parsed['executed-at'])
    : (outcome === 'expired' ? null : Math.floor(Date.now() / 1000));
  const feeBpsCharged = parsed.fee != null ? Number(parsed.fee) : null;
  const built = buildExecutionClaim({
    close,
    commitment,
    outcome,
    txHash: parsed.tx || null,
    amountReceived: parsed.received || null,
    feeBpsCharged,
    gasUsedWei: parsed.gas || null,
    executedAt
  }, { id: solver.id, publicKey: solver.publicKey }, solver.privateKey);
  if (!built.ok) fail(built.code, 1);
  process.stdout.write(`${JSON.stringify(built.claim, null, 2)}\n`);
  process.exit(0);
}

if (command === 'dispute' && args.length >= 1) {
  const parsed = parseArgs(args);
  if (parsed.positional.length < 1) usage();
  const close = readJson(parsed.positional[0], 'close receipt');
  if (!verifyAuctionClose(close)) fail('INVALID_AUCTION_CLOSE', 1);
  const verifier = verifierConfigFromPrivateKey();
  if (!verifier) {
    fail('INTENT_VERIFIER_PRIVATE_KEY is required (optionally INTENT_VERIFIER_ID / INTENT_VERIFIER_NAME).');
  }
  if (!parsed.kind) fail('--kind no-execution|short-fill|false-claim|late-execution is required.');
  const observedAt = parsed['observed-at'] != null
    ? Number(parsed['observed-at'])
    : Math.floor(Date.now() / 1000);
  const built = buildDispute({
    close,
    kind: parsed.kind,
    observedAt,
    detail: parsed.detail || null
  }, {
    id: verifier.id,
    name: verifier.name,
    publicKey: verifier.publicKey
  }, verifier.privateKey);
  if (!built.ok) fail(built.code, 1);
  process.stdout.write(`${JSON.stringify(built.dispute, null, 2)}\n`);
  process.exit(0);
}

if (command === 'verify-claim' && args.length === 3) {
  const [claimFile, closeFile, commitmentFile] = args;
  const claim = readJson(claimFile, 'claim');
  const close = readJson(closeFile, 'close receipt');
  const commitment = readJson(commitmentFile, 'commitment');
  if (!verifyAuctionClose(close)) fail('INVALID_AUCTION_CLOSE', 1);
  const checked = verifyExecutionClaim(claim, { close, commitment });
  if (!checked.ok) fail(checked.code, 1);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    claimId: claim.claimId,
    closeId: claim.closeId,
    entryHash: claim.entryHash,
    solverId: claim.solverId,
    outcome: claim.outcome,
    amountReceived: claim.amountReceived ?? null,
    onChainVerified: claim.claims?.onChainVerified
  }, null, 2)}\n`);
  process.exit(0);
}

if (command === 'grade' && args.length >= 2) {
  const { close, commitment, claim, disputes, adjudication, grace } = loadInputs(args);
  const evaluated = evaluateSettlement({
    close,
    commitment,
    claim,
    disputes,
    adjudication,
    evaluatedAtSeconds: Math.floor(Date.now() / 1000),
    graceSeconds: grace
  });
  if (!evaluated.ok) fail(evaluated.code, 1);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    intentHash: close.intentHash,
    closeId: close.closeId,
    verdict: evaluated.verdict,
    adjudicationConsistent: evaluated.adjudicationConsistent,
    penaltyBps: evaluated.penaltyBps,
    selfReported: evaluated.selfReported,
    quotedMinOut: evaluated.quotedMinOut,
    promisedOut: evaluated.promisedOut,
    deliveredOut: evaluated.deliveredOut,
    shortfallUnits: evaluated.shortfallUnits,
    shortfallBps: evaluated.shortfallBps,
    counts: evaluated.counts
  }, null, 2)}\n`);
  process.exit(0);
}

if (command === 'report' && args.length >= 2) {
  const { close, commitment, claim, disputes, adjudication, grace } = loadInputs(args);
  const verifier = verifierConfigFromPrivateKey();
  if (!verifier) {
    fail('INTENT_VERIFIER_PRIVATE_KEY is required (optionally INTENT_VERIFIER_ID / INTENT_VERIFIER_NAME).');
  }
  const built = buildSettlementReport({
    close,
    commitment,
    claim,
    disputes,
    adjudication,
    verifier,
    privateKey: verifier.privateKey,
    graceSeconds: grace
  });
  if (!built.ok) fail(built.code, 1);
  process.stdout.write(`${JSON.stringify(built.report, null, 2)}\n`);
  process.exit(0);
}

if (command === 'verify-report' && args.length === 2) {
  const [reportFile, closeFile] = args;
  const report = readJson(reportFile, 'settlement report');
  const close = readJson(closeFile, 'close receipt');
  /* No registry on purpose: third parties verify against the report's pinned
     verifier key. Submission-time registry checks are the server's concern. */
  const checked = verifySettlementReport(report, { close });
  if (!checked.ok) fail(checked.code, 1);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    reportId: report.reportId,
    closeId: report.closeId,
    intentHash: report.intentHash,
    verdict: report.verdict,
    adjudicationConsistent: report.adjudicationConsistent,
    promisedOut: report.promisedOut,
    deliveredOut: report.deliveredOut,
    shortfallBps: report.shortfallBps,
    verifier: report.verifier,
    evaluatedAt: report.evaluatedAt
  }, null, 2)}\n`);
  process.exit(0);
}

if (command === 'collect' && args.length >= 2) {
  const base = String(args[0]).replace(/\/$/, '');
  const intentHash = String(args[1]).toLowerCase();
  if (!/^https?:\/\//.test(base)) fail('baseUrl must be an http(s) URL.', 2);
  if (!/^0x[a-f0-9]{64}$/.test(intentHash)) fail('BAD_INTENT_HASH', 2);
  const get = async (path, allow404 = false) => {
    const response = await fetch(`${base}${path}`, { headers: { accept: 'application/json' } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok && !(allow404 && response.status === 404)) {
      fail(`GET ${path} → ${response.status}: ${body?.error || 'failed'}`, 1);
    }
    return response.ok ? body : null;
  };
  const state = await get(`/api/intents/v1/auctions/${intentHash}`);
  if (!state.close) fail('AUCTION_NOT_CLOSED', 1);
  const claim = await get(`/api/intents/v1/auctions/${intentHash}/execution-claim`, true);
  const disputes = await get(`/api/intents/v1/auctions/${intentHash}/disputes`);
  const adjudication = await get(`/api/intents/v1/auctions/${intentHash}/adjudication`, true);
  const reports = await get(`/api/intents/v1/auctions/${intentHash}/settlement-reports`);
  const evidence = {
    collectedAt: Date.now(),
    baseUrl: base,
    evidenceQuality: 'public-endpoint-signed-records',
    close: state.close,
    claim: claim || null,
    disputes: disputes?.disputes || [],
    adjudication: adjudication || null,
    settlement: reports?.settlement || null
  };
  const json = `${JSON.stringify(evidence, null, 2)}\n`;
  if (args[2]) fs.writeFileSync(args[2], json);
  else process.stdout.write(json);
  process.exit(0);
}

usage();
