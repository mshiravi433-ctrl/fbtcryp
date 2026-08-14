#!/usr/bin/env node
/** Offline Phase 4b helper. Private keys never leave the operator process. */

import fs from 'node:fs';
import {
  buildCrossChainReceipt,
  createCrossChainState,
  evaluateCrossChainState,
  verifyCrossChainReceipt
} from '../server/intentCrossChain.js';

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

fail([
  'Usage:',
  '  intent-cross-chain.mjs create <plan.json>',
  '  intent-cross-chain.mjs sign <state.json> [prior-receipt.json] --leg <leg> --tx <hash>',
  '  intent-cross-chain.mjs verify-receipt <state.json> <receipt.json> [prior-receipt.json]',
  '  intent-cross-chain.mjs verify-state <state.json> [receipt.json ...]'
].join('\n'));
