/**
 * FBT Insurance OS — Provider assembly (production).
 *
 * Registration policy:
 *
 *  - PRODUCTION (NODE_ENV=production): sandbox providers are structurally
 *    impossible — the sandbox branch never runs, and any attempt to register a
 *    SANDBOX-status provider throws SANDBOX_PROVIDER_DISABLED_IN_PRODUCTION.
 *    Only verified live providers (Nexus Mutual, InsurAce) register, each
 *    enabled strictly by its env flag and configuration. If none is configured
 *    the marketplace shows zero products with an honest "no provider
 *    configured" state — never a simulation.
 *
 *  - NON-PRODUCTION (dev/test): the sandbox providers remain available so the
 *    full pipeline can be exercised offline. They are labelled SANDBOX in
 *    every response and the UI shows an explicit sandbox notice.
 *
 * OpenCover is NOT a quoting provider: it is exposed separately as the
 * Verified Vault Coverage Registry (see adapters/opencover.js).
 */
import { registerProvider, quotingProviders } from '../provider-registry.js';
import { CHAIN_IDS } from '../constants.js';
import { isProduction, assertNoSandboxInProduction } from '../env.js';
import * as store from '../store.js';
import { NexusMutualAdapter } from './nexus-mutual.js';
import { InsurAceAdapter } from './insurace.js';
import { SandboxEVMProviderAdapter } from './sandbox-provider.js';
import { SolanaSandboxProviderAdapter } from './solana-sandbox-provider.js';

const EVM_CHAINS = [
  CHAIN_IDS.ethereum, CHAIN_IDS.bsc, CHAIN_IDS.polygon, CHAIN_IDS.arbitrum,
  CHAIN_IDS.optimism, CHAIN_IDS.base, CHAIN_IDS.avalanche, CHAIN_IDS.linea
];
const ALL_KINDS = ['smart-contract', 'bridge', 'stablecoin', 'lending', 'lp', 'wallet', 'oracle', 'defi-protocol'];

let installed = false;

/** Production invariant enforced even against programmatic registration. */
export function guardProductionRegistration(spec) {
  if (isProduction && String(spec?.status || '').toUpperCase() === 'SANDBOX') {
    assertNoSandboxInProduction(`provider "${spec?.id}"`);
  }
}

export function setupProviders() {
  if (installed) return;
  installed = true;

  /* ------------------------- real providers (always) ------------------------ */

  const nexus = new NexusMutualAdapter();
  registerProvider({
    id: 'nexus-mutual',
    name: 'Nexus Mutual',
    displayName: 'Nexus Mutual',
    configured: nexus.configured,
    enabled: nexus.enabled,
    status: nexus.configured ? 'LIVE' : 'NOT_CONFIGURED',
    supportedChains: nexus.supportedChains,
    supportedProducts: ALL_KINDS,
    adapter: nexus,
    settlementModel: 'DIRECT',
    commissionModel: { type: 'none', bps: 0, note: 'No FBT–Nexus commission agreement; commissionRatio=0 in every purchase' },
    contractAddresses: nexus.getProviderInfo().contractAddresses,
    apiEndpoints: {
      base: nexus.apiBase,
      products: `${nexus.apiBase}/products`,
      capacity: `${nexus.apiBase}/capacity/{productId}`,
      pricing: `${nexus.apiBase}/pricing/products/{productId}`,
      quote: `${nexus.apiBase}/quote`
    },
    sdkVersion: '@nexusmutual/sdk@3.x (verified 2026-09-07)',
    documentationUrl: 'https://docs.nexusmutual.io/developers/pos-integrations/',
    termsUrl: 'https://app.nexusmutual.io/cover/product/{id}/cover-wording',
    auditStatus: 'provider-published (Nexus Mutual audits)',
    riskScore: 'MEDIUM',
    disclaimer: nexus.getProviderInfo().disclaimer
  });

  const insurace = new InsurAceAdapter();
  registerProvider({
    id: 'insurace',
    name: 'InsurAce',
    displayName: 'InsurAce',
    configured: insurace.configured,
    enabled: insurace.enabled && insurace.configured, // disabled until API key exists
    status: insurace.configured ? 'LIVE' : 'NOT_CONFIGURED',
    supportedChains: insurace.supportedChains,
    supportedProducts: ALL_KINDS,
    adapter: insurace,
    settlementModel: 'DIRECT',
    commissionModel: { type: 'none', bps: 0, note: 'No FBT–InsurAce commission agreement; referralCode=null' },
    contractAddresses: { note: 'Cover contract addresses are provided by InsurAce to integrators; read from operator-verified env, purchase NOT_CONFIGURED until then' },
    apiEndpoints: { base: insurace.apiBase },
    documentationUrl: 'https://docs.insurace.io/landing-page/developer-reference/service-integration',
    auditStatus: 'provider-published (InsurAce audits)',
    riskScore: 'MEDIUM',
    disclaimer: insurace.getProviderInfo().disclaimer
  });

  /* --------------------- sandbox providers (dev/test ONLY) ------------------ */

  if (!isProduction) {
    // Structural gate: throws if this branch ever executes in production.
    assertNoSandboxInProduction('FBT Sandbox Protector (EVM)');

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
  }

  return listConfiguredProviderIds();
}

export function listConfiguredProviderIds() {
  return quotingProviders().map((p) => p.providerId);
}

export { registerProvider, quotingProviders };
