#!/usr/bin/env node
/**
 * Compiles contracts/IntentMerkleRootAnchor.sol
 *   -> src/lib/merkleRootAnchorArtifact.json
 *
 *   node scripts/compile-merkle-anchor.mjs
 *
 * Uses the repo-pinned solc 0.8.24 (matching the pragma). Tests never import
 * this artifact — server/intentRootAnchors.js keeps its hardcoded ABI so CI
 * does not depend on solc.
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
  console.error('solc is not installed. `npm i -D solc@0.8.24` first.');
  process.exit(1);
}

if (!String(solc.version()).includes('0.8.24')) {
  console.error(`✗ solc ${solc.version()} found, but IntentMerkleRootAnchor must compile with 0.8.24.`);
  console.error('  Run: npm i -D --save-exact solc@0.8.24');
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'contracts/IntentMerkleRootAnchor.sol'), 'utf8');

const input = {
  language: 'Solidity',
  sources: { 'IntentMerkleRootAnchor.sol': { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    /* paris avoids PUSH0 so the same bytecode deploys on chains that have not
       activated Shanghai. */
    evmVersion: 'paris',
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object', 'evm.gasEstimates'] } }
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

const c = out.contracts['IntentMerkleRootAnchor.sol'].IntentMerkleRootAnchor;
const artifact = {
  contractName: 'IntentMerkleRootAnchor',
  abi: c.abi,
  bytecode: '0x' + c.evm.bytecode.object,
  deployedBytecode: '0x' + c.evm.deployedBytecode.object,
  compiler: solc.version(),
  evmVersion: 'paris',
  optimizer: { enabled: true, runs: 200 }
};

const dest = path.join(root, 'src/lib/merkleRootAnchorArtifact.json');
fs.writeFileSync(dest, JSON.stringify(artifact, null, 2) + '\n');
console.log('✓ compiled IntentMerkleRootAnchor with', solc.version());
console.log('  bytecode:', (artifact.bytecode.length / 2 - 1), 'bytes (limit 24576)');
console.log('  functions:', artifact.abi.filter((x) => x.type === 'function').length);
console.log('  wrote', path.relative(root, dest));
