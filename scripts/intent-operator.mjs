#!/usr/bin/env node
/** Offline Phase 6 operator-attestation helper. */

import fs from 'node:fs';
import { parseSolverRegistry } from '../server/intentSignatures.js';
import { parseWatcherRegistry } from '../server/intentWatcher.js';
import { parseVerifierRegistry } from '../server/intentDisputes.js';
import { publicCoordinator } from '../server/intentAuctions.js';
import {
  buildOperatorAttestation,
  independentVerificationStatus,
  parseOperatorAttestations,
  verifyOperatorAttestation
} from '../server/intentOperators.js';

const [, , command, file] = process.argv;
const fail = (message, code = 2) => {
  console.error(message);
  process.exit(code);
};
const readJson = (path, label) => {
  try { return JSON.parse(fs.readFileSync(path, 'utf8')); }
  catch (error) { fail(`Cannot read ${label}: ${error.message}`); }
};
const output = (value) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);

if (command === 'attest') {
  if (!file) fail('Usage: intent-operator.mjs attest <attestation-input.json>');
  const privateKey = process.env.INTENT_OBSERVER_PRIVATE_KEY || '';
  if (!privateKey) fail('INTENT_OBSERVER_PRIVATE_KEY is required and must stay in the independent operator secrets manager.');
  const result = buildOperatorAttestation(readJson(file, 'attestation input'), privateKey);
  if (!result.ok) fail(result.code, 1);
  output(result.attestation);
  process.exit(0);
}

if (command === 'verify') {
  if (!file) fail('Usage: intent-operator.mjs verify <signed-attestation.json>');
  const result = verifyOperatorAttestation(readJson(file, 'operator attestation'));
  if (!result.ok) fail(result.code, 1);
  output({
    ok: true,
    attestationId: result.attestation.attestationId,
    operatorId: result.attestation.operatorId,
    role: result.attestation.role,
    registryId: result.attestation.registryId,
    publicKey: result.attestation.publicKey,
    expiresAt: result.attestation.expiresAt,
    organizationalIndependenceProven: false
  });
  process.exit(0);
}

if (command === 'status') {
  output(independentVerificationStatus({
    watcherRegistry: parseWatcherRegistry(),
    verifierRegistry: parseVerifierRegistry(),
    solverRegistry: parseSolverRegistry(),
    coordinator: publicCoordinator(),
    attestations: parseOperatorAttestations()
  }));
  process.exit(0);
}

fail('Usage: intent-operator.mjs <attest|verify|status> [file]');
