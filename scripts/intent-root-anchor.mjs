#!/usr/bin/env node
/** Offline manifest/calldata/verifier for optional Phase 6 Merkle anchors. */

import fs from 'node:fs';
import { getAddress } from 'ethers';
import {
  buildMerkleRootAnchorCalldata,
  buildMerkleRootManifest,
  verifyMerkleRootAnchorClaim
} from '../server/intentRootAnchors.js';

const [, , command, logFile, arg3, arg4] = process.argv;
const fail = (message, code = 2) => {
  console.error(message);
  process.exit(code);
};
const readJson = (file, label) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { fail(`Cannot read ${label}: ${error.message}`); }
};
const output = (value) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);

if (!['manifest', 'calldata', 'verify-anchor'].includes(command) || !logFile) {
  fail([
    'Usage: intent-root-anchor.mjs manifest <transparency-log.json>',
    '   or: intent-root-anchor.mjs calldata <transparency-log.json> <chainId> <contract>',
    '   or: intent-root-anchor.mjs verify-anchor <transparency-log.json> <claim.json>'
  ].join('\n'));
}

const log = readJson(logFile, 'transparency log');
const built = buildMerkleRootManifest(log);
if (!built.ok) fail(built.code, 1);

if (command === 'manifest') {
  output(built.manifest);
  process.exit(0);
}

if (command === 'calldata') {
  const chainId = Number(arg3);
  let contract;
  try { contract = getAddress(arg4); } catch { fail('A valid anchor contract address is required.'); }
  if (!Number.isInteger(chainId) || chainId <= 0) fail('A valid numeric chainId is required.');
  const networks = new Map([[chainId, {
    chainId,
    name: `Chain ${chainId}`,
    contract,
    rpcUrl: 'https://offline.invalid',
    explorerBaseUrl: null,
    minConfirmations: 1
  }]]);
  const result = buildMerkleRootAnchorCalldata(built.manifest, chainId, networks);
  if (!result.ok) fail(result.code, 1);
  output(result);
  process.exit(0);
}

const claim = readJson(arg3, 'anchor claim');
const result = await verifyMerkleRootAnchorClaim(built.manifest, claim);
if (!result.ok) fail(result.code, 1);
output(result);
