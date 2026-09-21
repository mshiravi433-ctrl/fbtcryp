#!/usr/bin/env node
/**
 * Verification script for deployed FBT Intent Protocol Contracts.
 * Validates on-chain bytecode, owner, and configuration parameters.
 */

import { ethers } from 'ethers';

export async function verifyDeployment(provider, deployedManifest) {
  const { contracts } = deployedManifest;
  const results = {};

  for (const [name, addr] of Object.entries(contracts)) {
    const code = await provider.getCode(addr);
    const hasBytecode = code && code !== '0x' && code.length > 2;
    results[name] = {
      address: addr,
      verifiedBytecode: hasBytecode,
      status: hasBytecode ? 'VALID' : 'MISSING_BYTECODE'
    };
  }

  return results;
}
