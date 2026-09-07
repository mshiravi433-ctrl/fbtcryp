/**
 * FBT Insurance OS — Provider assembly.
 *
 * Builds adapters and registers them in the Provider Registry. Only sandbox
 * providers are `configured`+`enabled` in v1. Real providers (e.g. Nexus
 * Mutual) register disabled until verified (§ honesty). The FBT internal pool
 * adapter is intentionally not created: that feature is future/off (§30).
 */
import { registerProvider, quotingProviders } from '../provider-registry.js';
import * as store from '../store.js';
import { PROTECTION_TYPES, CHAIN_IDS } from '../constants.js';
import { SandboxEVMProviderAdapter } from './sandbox-provider.js';
import { SolanaSandboxProviderAdapter } from './solana-sandbox-provider.js';
import { NexusMutualAdapter } from './nexus-mutual.js';

const EVM_CHAINS = [
  CHAIN_IDS.ethereum, CHAIN_IDS.bsc, CHAIN_IDS.polygon, CHAIN_IDS.arbitrum,
  CHAIN_IDS.optimism, CHAIN_IDS.base, CHAIN_IDS.avalanche, CHAIN_IDS.linea
];
const ALL_KINDS = PROTECTION_TYPES.map((t) => t.id);

let installed = false;

export function setupProviders() {
  if (installed) return;
  installed = true;

  // EVM sandbox provider (single instance across EVM chains).
  registerProvider({
    id: 'fbt-sandbox-evm',
    name: 'FBT Sandbox Protector (EVM)',
    displayName: 'FBT Sandbox Protector',
    configured: true, // configured as a SANDBOX, never as a real underwriter
    enabled: true,
    status: 'SANDBOX',
    supportedChains: EVM_CHAINS,
    supportedProducts: ALL_KINDS,
    adapter: new SandboxEVMProviderAdapter({
      providerInfo: {
        id: 'fbt-sandbox-evm',
        name: 'FBT Sandbox Protector (EVM)',
        chainKind: 'evm',
        settlementModel: 'DIRECT',
        sandboxRecipient: '0x00000000000000000000000000000000fB7b0b00',
        sandboxToken: '0x0000000000000000000000000000000000000000'
      },
      supportedProducts: ALL_KINDS,
      supportedChains: EVM_CHAINS,
      opts: { store, chainId: CHAIN_IDS.bsc }
    }),
    settlementModel: 'DIRECT',
    commissionModel: { type: 'none', bps: 0, note: 'Sandbox — no commission agreement; no fee taken' },
    contractAddresses: { note: 'sandbox — no deployed contract' },
    riskScore: 'LOW',
    auditStatus: 'none'
  });

  // Solana sandbox provider (§17).
  registerProvider({
    id: 'fbt-sandbox-solana',
    name: 'FBT Sandbox Protector (Solana)',
    displayName: 'FBT Sandbox Protector (Solana)',
    configured: true,
    enabled: true,
    status: 'SANDBOX',
    supportedChains: [CHAIN_IDS.solana],
    supportedProducts: ALL_KINDS,
    adapter: new SolanaSandboxProviderAdapter({
      providerInfo: {
        id: 'fbt-sandbox-solana', name: 'FBT Sandbox Protector (Solana)', chainKind: 'solana', settlementModel: 'DIRECT'
      },
      supportedProducts: ALL_KINDS,
      supportedChains: [CHAIN_IDS.solana],
      opts: { store, chainId: CHAIN_IDS.solana }
    }),
    settlementModel: 'DIRECT',
    commissionModel: { type: 'none', bps: 0, note: 'Sandbox — no commission agreement' },
    riskScore: 'LOW',
    auditStatus: 'none'
  });

  // Real external provider — registered but DISABLED until verified (§ do-not-invent).
  registerProvider({
    id: 'nexus-mutual',
    name: 'Nexus Mutual',
    displayName: 'Nexus Mutual',
    configured: false,
    enabled: false,
    status: 'STUB',
    supportedChains: [],
    supportedProducts: [],
    adapter: new NexusMutualAdapter(),
    settlementModel: 'DIRECT',
    commissionModel: { type: 'none', bps: 0, note: 'pending provider agreement' },
    auditStatus: 'pending'
  });

  return listConfiguredProviderIds();
}

export function listConfiguredProviderIds() {
  return quotingProviders().map((p) => p.providerId);
}

export { registerProvider, quotingProviders };
