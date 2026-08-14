#!/usr/bin/env node
/** Offline Phase 4b/4c helper. Private keys never leave the operator process. */

import fs from 'node:fs';
import {
  buildCrossChainReceipt,
  createCrossChainState,
  evaluateCrossChainState,
  verifyCrossChainReceipt
} from '../server/intentCrossChain.js';
import {
  buildAccountBinding,
  buildTxVerificationReport,
  parseCrossChainRpcNetworks,
  verifyAccountBinding,
  verifyLegOnChain,
  verifyTxVerificationReport
} from '../server/intentCrossChainVerification.js';
import { publicKeyFromPrivateKey } from '../server/intentSignatures.js';

const args = process.argv.slice(2);
const command = args.shift();
const fail = (message, code = 2) => {
  console.error(message);
  process.exit(code);
};
const readJson = (file, label) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { fail(`Cannot read ${label}: ${error.message}`); }
};
const option = (name, fallback = null) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] != null ? args[index + 1] : fallback;
};
const output = (value) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);

if (command === 'create') {
  const file = args[0];
  if (!file) fail('Usage: intent-cross-chain.mjs create <plan.json>');
  const result = createCrossChainState(readJson(file, 'cross-chain plan'));
  if (!result.ok) fail(result.code, 1);
  output(result.state);
  process.exit(0);
}

if (command === 'sign') {
  const stateFile = args[0];
  if (!stateFile) {
    fail('Usage: intent-cross-chain.mjs sign <state.json> [prior-receipt.json] --leg <source-transfer|destination-transfer|refund> --tx <0x...> [--signed-at epochSeconds]');
  }
  const leg = option('--leg');
  const txHash = option('--tx');
  const signedAt = Number(option('--signed-at', Math.floor(Date.now() / 1000)));
  const priorFile = args[1]?.startsWith('--') ? null : args[1];
  const privateKey = process.env.INTENT_CROSS_CHAIN_PRIVATE_KEY || '';
  if (!privateKey) fail('INTENT_CROSS_CHAIN_PRIVATE_KEY is required and must stay in the party secrets manager.');
  const result = buildCrossChainReceipt({
    state: readJson(stateFile, 'cross-chain state'),
    previousReceipts: priorFile ? [readJson(priorFile, 'prior receipt')] : [],
    leg,
    txHash,
    signedAt
  }, privateKey);
  if (!result.ok) fail(result.code, 1);
  output(result.receipt);
  process.exit(0);
}

if (command === 'verify-receipt') {
  const [stateFile, receiptFile, priorFile] = args;
  if (!stateFile || !receiptFile) {
    fail('Usage: intent-cross-chain.mjs verify-receipt <state.json> <receipt.json> [prior-receipt.json]');
  }
  const result = verifyCrossChainReceipt(readJson(receiptFile, 'receipt'), {
    state: readJson(stateFile, 'state'),
    previousReceipts: priorFile ? [readJson(priorFile, 'prior receipt')] : []
  });
  if (!result.ok) fail(result.code, 1);
  output({
    ok: true,
    schema: result.receipt.schema,
    stateId: result.receipt.stateId,
    receiptId: result.receipt.receiptId,
    leg: result.receipt.leg,
    signer: result.receipt.signer,
    claims: result.receipt.claims
  });
  process.exit(0);
}

if (command === 'verify-state') {
  const stateFile = args[0];
  if (!stateFile) fail('Usage: intent-cross-chain.mjs verify-state <state.json> [receipt.json ...]');
  const receipts = args.slice(1).map((file) => readJson(file, 'receipt'));
  const result = evaluateCrossChainState(readJson(stateFile, 'state'), receipts);
  if (!result.ok) fail(result.code, 1);
  output(result);
  process.exit(0);
}

/* --------------------------- Phase 4c commands ---------------------------- */

if (command === 'bind-account') {
  const stateFile = args[0];
  if (!stateFile) {
    fail('Usage: intent-cross-chain.mjs bind-account <state.json> --party <partyId> --chain <chainId> --address <0x...> --expires-at <epochSeconds>');
  }
  const privateKey = process.env.INTENT_CROSS_CHAIN_PRIVATE_KEY || '';
  if (!privateKey) fail('INTENT_CROSS_CHAIN_PRIVATE_KEY is required and must stay in the party secrets manager.');
  const result = buildAccountBinding({
    state: readJson(stateFile, 'cross-chain state'),
    partyId: option('--party'),
    chainId: Number(option('--chain')),
    address: option('--address'),
    issuedAt: Number(option('--issued-at', Math.floor(Date.now() / 1000))),
    expiresAt: Number(option('--expires-at'))
  }, privateKey);
  if (!result.ok) fail(result.code, 1);
  output(result.binding);
  process.exit(0);
}

if (command === 'verify-binding') {
  const [stateFile, bindingFile] = args;
  if (!stateFile || !bindingFile) {
    fail('Usage: intent-cross-chain.mjs verify-binding <state.json> <binding.json>');
  }
  const result = verifyAccountBinding(readJson(bindingFile, 'account binding'), {
    state: readJson(stateFile, 'cross-chain state')
  });
  if (!result.ok) fail(result.code, 1);
  output({
    ok: true,
    schema: result.binding.schema,
    bindingId: result.binding.bindingId,
    stateId: result.binding.stateId,
    partyId: result.binding.partyId,
    chainId: result.binding.chainId,
    address: result.binding.address,
    expiresAt: result.binding.expiresAt,
    claims: result.binding.claims
  });
  process.exit(0);
}

if (command === 'verify-tx') {
  const stateFile = args[0];
  if (!stateFile) {
    fail('Usage: INTENT_CROSS_CHAIN_RPC_NETWORKS=... intent-cross-chain.mjs verify-tx <state.json> --receipt <receipt.json> --from-binding <b.json> --to-binding <b.json> [--prior <receipt.json>]');
  }
  const networks = parseCrossChainRpcNetworks();
  if (!networks.size) {
    fail('INTENT_CROSS_CHAIN_RPC_NETWORKS must configure at least two https endpoints with distinct hostnames per chain. RPC URLs stay in the local env; they are never printed.');
  }
  const priorFile = option('--prior');
  const result = await verifyLegOnChain({
    state: readJson(stateFile, 'cross-chain state'),
    receipt: readJson(option('--receipt'), 'leg receipt'),
    previousReceipts: priorFile ? [readJson(priorFile, 'prior receipt')] : [],
    fromBinding: readJson(option('--from-binding'), 'sender binding'),
    toBinding: readJson(option('--to-binding'), 'recipient binding'),
    networks
  });
  if (!result.ok) fail(result.code, 1);
  /* Everything except the endpoints themselves. */
  output({
    ok: true,
    stateId: result.state.stateId,
    receiptId: result.receipt.receiptId,
    leg: result.receipt.leg,
    chainId: result.network.chainId,
    minConfirmations: result.network.minConfirmations,
    result: result.result
  });
  process.exit(result.result.final ? 0 : 1);
}

if (command === 'sign-verification') {
  const stateFile = args[0];
  if (!stateFile) {
    fail('Usage: INTENT_CROSS_CHAIN_VERIFIER_PRIVATE_KEY=... INTENT_CROSS_CHAIN_RPC_NETWORKS=... intent-cross-chain.mjs sign-verification <state.json> --receipt <receipt.json> --from-binding <b.json> --to-binding <b.json> --verifier-id <id> [--prior <receipt.json>]');
  }
  const privateKey = process.env.INTENT_CROSS_CHAIN_VERIFIER_PRIVATE_KEY || '';
  if (!privateKey) fail('INTENT_CROSS_CHAIN_VERIFIER_PRIVATE_KEY is required and must stay in the verifier secrets manager.');
  const networks = parseCrossChainRpcNetworks();
  if (!networks.size) {
    fail('INTENT_CROSS_CHAIN_RPC_NETWORKS must configure at least two https endpoints with distinct hostnames per chain.');
  }
  const priorFile = option('--prior');
  const result = await buildTxVerificationReport({
    state: readJson(stateFile, 'cross-chain state'),
    receipt: readJson(option('--receipt'), 'leg receipt'),
    previousReceipts: priorFile ? [readJson(priorFile, 'prior receipt')] : [],
    fromBinding: readJson(option('--from-binding'), 'sender binding'),
    toBinding: readJson(option('--to-binding'), 'recipient binding'),
    verifier: { id: option('--verifier-id') },
    networks
  }, privateKey);
  if (!result.ok) fail(result.code, 1);
  output(result.report);
  process.exit(0);
}

if (command === 'verify-report') {
  const stateFile = args[0];
  if (!stateFile) {
    fail('Usage: intent-cross-chain.mjs verify-report <state.json> --report <report.json> --receipt <receipt.json> --from-binding <b.json> --to-binding <b.json> [--prior <receipt.json>] [--verifier-public-key <base64url>]');
  }
  const report = readJson(option('--report'), 'verification report');
  const priorFile = option('--prior');
  const expectedKey = option('--verifier-public-key', report?.verifier?.publicKey);
  const registry = new Map(report?.verifier?.id && expectedKey
    ? [[report.verifier.id, { id: report.verifier.id, publicKey: expectedKey, active: true }]]
    : []);
  const result = verifyTxVerificationReport(report, {
    state: readJson(stateFile, 'cross-chain state'),
    receipt: readJson(option('--receipt'), 'leg receipt'),
    previousReceipts: priorFile ? [readJson(priorFile, 'prior receipt')] : [],
    fromBinding: readJson(option('--from-binding'), 'sender binding'),
    toBinding: readJson(option('--to-binding'), 'recipient binding'),
    registry
  });
  if (!result.ok) fail(result.code, 1);
  output({
    ok: true,
    reportId: result.report.reportId,
    stateId: result.report.stateId,
    receiptId: result.report.receiptId,
    leg: result.report.leg,
    verdict: result.report.verdict,
    rejectReason: result.report.rejectReason,
    confirmations: result.report.confirmations,
    quorum: result.report.quorum,
    verifier: result.report.verifier,
    claims: result.report.claims
  });
  process.exit(0);
}

if (command === 'keygen-info') {
  /* Convenience: show the PUBLIC key for a locally held private key without
     ever writing the private key anywhere. */
  const privateKey = process.env.INTENT_CROSS_CHAIN_PRIVATE_KEY || '';
  if (!privateKey) fail('INTENT_CROSS_CHAIN_PRIVATE_KEY is required.');
  try {
    output({ publicKey: publicKeyFromPrivateKey(privateKey), algorithm: 'Ed25519' });
    process.exit(0);
  } catch {
    fail('BAD_PRIVATE_KEY', 1);
  }
}

fail([
  'Usage:',
  '  intent-cross-chain.mjs create <plan.json>',
  '  intent-cross-chain.mjs sign <state.json> [prior-receipt.json] --leg <leg> --tx <hash>',
  '  intent-cross-chain.mjs verify-receipt <state.json> <receipt.json> [prior-receipt.json]',
  '  intent-cross-chain.mjs verify-state <state.json> [receipt.json ...]',
  '  intent-cross-chain.mjs bind-account <state.json> --party <id> --chain <chainId> --address <0x...> --expires-at <s>',
  '  intent-cross-chain.mjs verify-binding <state.json> <binding.json>',
  '  intent-cross-chain.mjs verify-tx <state.json> --receipt <r.json> --from-binding <b.json> --to-binding <b.json>',
  '  intent-cross-chain.mjs sign-verification <state.json> --receipt <r.json> --from-binding <b.json> --to-binding <b.json> --verifier-id <id>',
  '  intent-cross-chain.mjs verify-report <state.json> --report <v.json> --receipt <r.json> --from-binding <b.json> --to-binding <b.json>',
  '',
  'Private keys and RPC URLs live ONLY in the local environment',
  '(INTENT_CROSS_CHAIN_PRIVATE_KEY, INTENT_CROSS_CHAIN_VERIFIER_PRIVATE_KEY,',
  ' INTENT_CROSS_CHAIN_RPC_NETWORKS) and are never printed.'
].join('\n'));
