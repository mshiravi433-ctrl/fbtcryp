#!/usr/bin/env node
/**
 * Compiles contracts/IntentWorkflowBatch.sol -> src/lib/workflowBatchArtifact.json
 *
 *   node scripts/compile-workflow.mjs
 *
 * Requires the `solc` npm package (same as scripts/compile.mjs). Tests never
 * import this artifact — they use the hardcoded ABI in server/intentWorkflow.js
 * so CI does not need solc.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let solc;
try {
  solc = require('solc');
} catch {
  console.error('solc is not installed. `npm i solc` (dev) or skip — tests use the hardcoded ABI.');
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'contracts/IntentWorkflowBatch.sol'), 'utf8');

const input = {
  language: 'Solidity',
  sources: { 'IntentWorkflowBatch.sol': { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: 'paris',
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.gasEstimates'] } }
  }
};

const out = JSON.parse(solc.compile(JSON.stringify(input)));
const errors = (out.errors || []).filter((e) => e.severity === 'error');
const warnings = (out.errors || []).filter((e) => e.severity === 'warning');
warnings.forEach((w) => console.log('⚠ ', w.formattedMessage.split('\n')[0]));
if (errors.length) {
  errors.forEach((e) => console.error(e.formattedMessage));
  process.exit(1);
}

const c = out.contracts['IntentWorkflowBatch.sol'].IntentWorkflowBatch;
const artifact = {
  contractName: 'IntentWorkflowBatch',
  abi: c.abi,
  bytecode: `0x${c.evm.bytecode.object}`,
  compiler: solc.version(),
  evmVersion: 'paris',
  optimizer: { enabled: true, runs: 200 },
  custody: false,
  holdsTokens: false,
  verifiesCallOutputs: false,
  maxCalls: 8
};

const dest = path.join(root, 'src/lib/workflowBatchArtifact.json');
fs.writeFileSync(dest, `${JSON.stringify(artifact, null, 2)}\n`);
console.log('✓ compiled IntentWorkflowBatch');
console.log('  bytecode:', (artifact.bytecode.length / 2 - 1), 'bytes (limit 24576)');
console.log('  functions:', artifact.abi.filter((x) => x.type === 'function').length);
console.log('  wrote', dest);
