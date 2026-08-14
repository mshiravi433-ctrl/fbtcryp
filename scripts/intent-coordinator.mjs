#!/usr/bin/env node
/** Offline dual-signature coordinator-key rotation ceremony. */

import fs from 'node:fs';
import {
  createCoordinatorRotationDraft,
  publicCoordinator,
  signCoordinatorRotation,
  verifyCoordinatorRotation
} from '../server/intentAuctions.js';

const [, , command, ...args] = process.argv;
const fail = (message, code = 2) => {
  console.error(message);
  process.exit(code);
};
const output = (value) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
const readJson = (file) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { fail(`Cannot read rotation record: ${error.message}`); }
};

if (command === 'draft') {
  const [oldPublicKey, newPublicKey, activatedAtRaw] = args;
  const coordinatorId = String(process.env.INTENT_COORDINATOR_ID || 'fbt-coordinator').toLowerCase();
  const activatedAt = Number(activatedAtRaw || Date.now());
  const result = createCoordinatorRotationDraft({ coordinatorId, oldPublicKey, newPublicKey, activatedAt });
  if (!result.ok) fail(result.code, 1);
  output(result.rotation);
  process.exit(0);
}

if (command === 'sign-old' || command === 'sign-new') {
  const file = args[0];
  if (!file) fail(`Usage: intent-coordinator.mjs ${command} <rotation.json>`);
  const privateKey = process.env.INTENT_COORDINATOR_ROTATION_PRIVATE_KEY || '';
  if (!privateKey) {
    fail('INTENT_COORDINATOR_ROTATION_PRIVATE_KEY is required only in this offline ceremony and must never be a server/VITE_* secret.');
  }
  const result = signCoordinatorRotation(readJson(file), privateKey, command === 'sign-old' ? 'old' : 'new');
  if (!result.ok) fail(result.code, 1);
  output(result.rotation);
  process.exit(0);
}

if (command === 'verify') {
  const file = args[0];
  if (!file) fail('Usage: intent-coordinator.mjs verify <dual-signed-rotation.json>');
  const rotation = readJson(file);
  if (!verifyCoordinatorRotation(rotation)) fail('INVALID_COORDINATOR_ROTATION', 1);
  output({
    ok: true,
    schema: rotation.schema,
    rotationId: rotation.rotationId,
    coordinatorId: rotation.coordinatorId,
    oldPublicKey: rotation.oldPublicKey,
    newPublicKey: rotation.newPublicKey,
    activatedAt: rotation.activatedAt,
    claims: rotation.claims
  });
  process.exit(0);
}

if (command === 'keyring') {
  const coordinator = publicCoordinator();
  if (!coordinator) fail('AUCTION_CLOSE_NOT_CONFIGURED', 1);
  output(coordinator);
  process.exit(0);
}

fail([
  'Usage:',
  '  intent-coordinator.mjs draft <oldPublicKey> <newPublicKey> [activatedAtMs]',
  '  intent-coordinator.mjs sign-old <rotation.json>',
  '  intent-coordinator.mjs sign-new <rotation.json>',
  '  intent-coordinator.mjs verify <rotation.json>',
  '  intent-coordinator.mjs keyring'
].join('\n'));
