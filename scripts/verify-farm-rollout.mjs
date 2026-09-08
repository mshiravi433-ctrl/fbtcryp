#!/usr/bin/env node
/**
 * Fail-closed gate for a deliberately small DeFi canary build.
 *
 * This script does not decide that a fork passed. The operator must supply an
 * external evidence marker after the strict fork probes have completed. It
 * also refuses an empty allowlist: `build:full` intentionally remains a
 * public, money-path-off build.
 */
const protocols = [
  ['AAVE Base USDC', 'VITE_ENABLE_AAVE_BASE_SUPPLY', 'VITE_AAVE_BASE_SUPPLY_ALLOWLIST'],
  ['Compound Base USDC', 'VITE_ENABLE_COMPOUND_BASE_SUPPLY', 'VITE_COMPOUND_BASE_SUPPLY_ALLOWLIST'],
  ['Aave Arbitrum USDC', 'VITE_ENABLE_AAVE_ARBITRUM_SUPPLY', 'VITE_AAVE_ARB_SUPPLY_ALLOWLIST'],
  ['Lido Ethereum ETH', 'VITE_ENABLE_LIDO_STAKE', 'VITE_LIDO_STAKE_ALLOWLIST'],
  ['Morpho Blue Base selected market', 'VITE_ENABLE_MORPHO_BASE_SUPPLY', 'VITE_MORPHO_BASE_SUPPLY_ALLOWLIST']
];

const valid = (value) => String(value ?? '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean)
  .every((item) => /^0x[a-fA-F0-9]{40}$/.test(item));

if (process.env.FARM_STRICT_FORK_EVIDENCE !== 'true') {
  console.error('FARM_STRICT_FORK_EVIDENCE=true is required after successful --strict fork probes.');
  process.exit(1);
}

for (const [label, flag, allowlist] of protocols) {
  if (process.env[flag] !== 'true') {
    console.error(`${label}: ${flag}=true is required for a canary build.`);
    process.exit(1);
  }
  const entries = String(process.env[allowlist] ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  if (entries.length === 0 || !valid(process.env[allowlist])) {
    console.error(`${label}: ${allowlist} must contain at least one valid public 0x address.`);
    process.exit(1);
  }
}

console.log('Farm rollout gate passed: strict-fork evidence marker and non-empty allowlists are present.');
console.log('This is a limited canary configuration; it is not public capital enablement.');
