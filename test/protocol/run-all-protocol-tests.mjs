#!/usr/bin/env node
/**
 * Test Runner for the FBT Intent Protocol Test Suite
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const testSuites = [
  'test/protocol/unit-intent-schema.test.mjs',
  'test/protocol/unit-hashing-signature.test.mjs',
  'test/protocol/unit-nonce-lifecycle.test.mjs',
  'test/protocol/unit-solver-auction.test.mjs',
  'test/protocol/unit-execution-receipt.test.mjs',
  'test/protocol/integration-ai-to-settlement.test.mjs',
  'test/protocol/security-invariants.test.mjs',
  'test/protocol/evm-solana-adapters.test.mjs',
  'test/protocol/smart-contract-invariants.test.mjs',
  'test/protocol/api-protocol-routes.test.mjs',
  'test/protocol/sdk.test.mjs'
];

console.log('====================================================');
console.log('       FBT INTENT PROTOCOL TEST SUITE RUNNER        ');
console.log('====================================================\n');

let passed = 0;
let failed = 0;

for (const suite of testSuites) {
  const fullPath = path.join(root, suite);
  try {
    process.stdout.write(`► Running ${suite}... `);
    const output = execFileSync(process.execPath, [fullPath], { encoding: 'utf8' });
    console.log('✓ PASS');
    passed++;
  } catch (err) {
    console.log('✗ FAIL');
    console.error(err.stdout || err.stderr || err.message);
    failed++;
  }
}

console.log('\n====================================================');
console.log(`Results: ${passed} passed, ${failed} failed across ${testSuites.length} suites.`);
console.log('====================================================');

if (failed > 0) {
  process.exit(1);
}
