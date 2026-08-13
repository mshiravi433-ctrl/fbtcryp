#!/usr/bin/env node
/** Offline verifier/calldata helper for fbt.auction-close.v1. */

import fs from 'node:fs';
import { getAddress } from 'ethers';
import { verifyAuctionClose } from '../server/intentAuctions.js';
import { buildAnchorCalldata, verifyAnchorClaim } from '../server/intentAnchors.js';

const [, , command, closeFile, arg3, arg4] = process.argv;
const readJson = (file, label) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) {
    console.error(`Cannot read ${label}: ${error.message}`);
    process.exit(2);
  }
};

if (!['verify', 'calldata', 'verify-anchor'].includes(command) || !closeFile) {
  console.error('Usage: intent-auction.mjs verify <close.json>');
  console.error('   or: intent-auction.mjs calldata <close.json> <chainId> <contract>');
  console.error('   or: intent-auction.mjs verify-anchor <close.json> <claim.json>');
  process.exit(2);
}

const close = readJson(closeFile, 'close receipt');
if (!verifyAuctionClose(close)) {
  console.error('INVALID_AUCTION_CLOSE');
  process.exit(1);
}

if (command === 'verify') {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    closeId: close.closeId,
    intentHash: close.intentHash,
    root: close.logRoot,
    size: close.logSize,
    selectedEntryHash: close.decision.selectedEntryHash,
    coordinator: close.coordinator,
    claims: close.claims
  }, null, 2)}\n`);
  process.exit(0);
}

if (command === 'calldata') {
  const chainId = Number(arg3);
  if (!Number.isInteger(chainId) || chainId <= 0) {
    console.error('A valid numeric chainId is required.');
    process.exit(2);
  }
  let contract;
  try { contract = getAddress(arg4); } catch {
    console.error('A valid anchor contract address is required.');
    process.exit(2);
  }
  const networks = new Map([[chainId, {
    chainId,
    name: `Chain ${chainId}`,
    contract,
    rpcUrl: 'https://offline.invalid',
    explorerBaseUrl: null,
    minConfirmations: 1
  }]]);
  const result = buildAnchorCalldata(close, chainId, networks);
  if (!result.ok) {
    console.error(result.code);
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(0);
}

const claim = readJson(arg3, 'anchor claim');
const result = await verifyAnchorClaim(close, claim);
if (!result.ok) {
  console.error(result.code);
  process.exit(1);
}
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
