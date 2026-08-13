#!/usr/bin/env node
/**
 * Minimal FBT solver commitment CLI.
 *
 * Generate a key pair:
 *   node scripts/intent-solver.mjs keygen
 *
 * Sign quote.json and write the signed commitment to stdout:
 *   INTENT_SOLVER_PRIVATE_KEY=... node scripts/intent-solver.mjs sign quote.json
 *
 * Submit without exposing the private key to FBT:
 *   curl -X POST "$FBT_URL/api/intents/v1/commitments" \
 *     -H 'content-type: application/json' --data-binary @signed.json
 *
 * The private key is printed once by `keygen`; store it in a secrets manager.
 * Never put it in VITE_*, the repository, an issue, or a chat.
 */

import fs from 'node:fs';
import {
  SOLVER_QUOTE_SCHEMA,
  generateSolverKeyPair,
  signSolverCommitment,
  validateSolverCommitment
} from '../server/intentSignatures.js';

const [, , command, file] = process.argv;

if (command === 'keygen') {
  const pair = generateSolverKeyPair();
  process.stdout.write(`${JSON.stringify({
    algorithm: 'Ed25519',
    publicKey: pair.publicKey,
    privateKey: pair.privateKey,
    warning: 'Store privateKey in a secrets manager. Publish only publicKey.'
  }, null, 2)}\n`);
  process.exit(0);
}

if (command === 'example') {
  const now = Math.floor(Date.now() / 1000);
  process.stdout.write(`${JSON.stringify({
    schema: SOLVER_QUOTE_SCHEMA,
    intentHash: `0x${'00'.repeat(32)}`,
    solverId: 'your-solver-id',
    chainId: 42161,
    amountOut: '400000000000000000',
    maxGas: '250000',
    feeBps: 70,
    slippageBps: 50,
    executable: true,
    issuedAt: now,
    validUntil: now + 90,
    nonce: `0x${'11'.repeat(16)}`,
    routeCommitment: `0x${'22'.repeat(32)}`
  }, null, 2)}\n`);
  process.exit(0);
}

if (command === 'sign' && file) {
  const privateKey = process.env.INTENT_SOLVER_PRIVATE_KEY || '';
  if (!privateKey) {
    console.error('INTENT_SOLVER_PRIVATE_KEY is required and must stay server-side.');
    process.exit(2);
  }
  let quote;
  try {
    quote = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    console.error(`Cannot read quote JSON: ${error.message}`);
    process.exit(2);
  }
  /* Add a placeholder only so structural validation can run before signing. */
  const structural = validateSolverCommitment({ ...quote, signature: 'A'.repeat(86) });
  if (!structural.ok && structural.code !== 'BAD_SIGNATURE') {
    console.error(`Invalid commitment: ${structural.code}`);
    process.exit(2);
  }
  try {
    process.stdout.write(`${JSON.stringify(signSolverCommitment(quote, privateKey), null, 2)}\n`);
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
  process.exit(0);
}

console.error('Usage: intent-solver.mjs keygen | example | sign <quote.json>');
process.exit(2);
