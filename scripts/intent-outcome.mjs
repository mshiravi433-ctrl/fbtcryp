#!/usr/bin/env node
/**
 * Outcome marketplace CLI (Phase 5: Outcome Marketplace).
 *
 *   # Generate a solver key pair (reuse the same Ed25519 tooling):
 *   node scripts/intent-solver.mjs keygen
 *
 *   # Print a bounded example outcome bid to edit:
 *   node scripts/intent-outcome.mjs example > outcome-bid.json
 *
 *   # Sign an outcome bid (private key stays in YOUR secrets manager):
 *   INTENT_SOLVER_PRIVATE_KEY='…' node scripts/intent-outcome.mjs sign outcome-bid.json > signed.json
 *
 *   # Submit the signed bid (server rejects unregistered / unbonded solvers):
 *   curl -X POST "$FBT_URL/api/intents/v1/outcome/bids" \
 *     -H 'content-type: application/json' --data-binary @signed.json
 *
 *   # Reclaim a lost admission receipt (deterministic reclaim):
 *   curl "$FBT_URL/api/intents/v1/outcome/admissions/$INTENT_HASH/$ENTRY_HASH"
 *
 * The private key is never printed by `sign` and must never be put in
 * VITE_*, the repository, an issue, or a chat.
 */

import fs from 'node:fs';
import {
  OUTCOME_BID_SCHEMA,
  signOutcomeBid,
  validateOutcomeBid
} from '../server/outcomeBids.js';
import { outcomeSolverConfigFromPrivateKey } from '../server/outcomeBids.js';

const [, , command, file] = process.argv;

if (command === 'example') {
  const now = Math.floor(Date.now() / 1000);
  process.stdout.write(`${JSON.stringify({
    schema: OUTCOME_BID_SCHEMA,
    intentHash: `0x${'00'.repeat(32)}`,
    solverId: 'mm-a',
    chainId: 42161,
    settlementChainId: 42161,
    guaranteedMinimum: '10000000000000000000',
    totalMaxCost: '20000000000000000000000',
    feeBps: 70,
    slippageBps: 50,
    partialFillPolicy: 'full-only',
    expiry: now + 86400,
    executable: true,
    issuedAt: now,
    validUntil: now + 90,
    nonce: `0x${'11'.repeat(16)}`,
    routeCommitment: `0x${'22'.repeat(32)}`
  }, null, 2)}\n`);
  process.exit(0);
}

if (command === 'sign' && file) {
  const solver = outcomeSolverConfigFromPrivateKey();
  if (!solver) {
    console.error('INTENT_SOLVER_PRIVATE_KEY + INTENT_SOLVER_ID are required and must stay server-side.');
    process.exit(2);
  }
  let bid;
  try {
    bid = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    console.error(`Cannot read outcome bid JSON: ${error.message}`);
    process.exit(2);
  }
  const check = validateOutcomeBid(bid);
  if (!check.ok) {
    console.error(`Outcome bid failed validation: ${check.code}`);
    process.exit(2);
  }
  const signed = signOutcomeBid({ ...bid, solverId: solver.id }, solver.privateKey);
  process.stdout.write(`${JSON.stringify(signed, null, 2)}\n`);
  process.exit(0);
}

console.error(`Unknown command: ${command}\nUsage: node scripts/intent-outcome.mjs (example|sign <bid.json>)`);
process.exit(2);
