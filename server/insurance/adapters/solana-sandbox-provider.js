/**
 * FBT Insurance OS — Sandbox Solana provider adapter (SIMULATION, §17).
 *
 * Same InsuranceProviderAdapter abstraction, Solana-flavoured prepared payload
 * so the architecture is not EVM-only. Nothing here is a real Solana program:
 * the recipient is an explicit sandbox address and the UI labels it as such.
 */
import { SandboxEVMProviderAdapter } from './sandbox-provider.js';

export const SOLANA_SANDBOX_RECIPIENT = 'SandboxRecipient11111111111111111111111111111111';

export class SolanaSandboxProviderAdapter extends SandboxEVMProviderAdapter {
  getProviderInfo() {
    return {
      ...super.getProviderInfo(),
      chainKind: 'solana',
      disclaimer: 'Simulated Solana sandbox provider — not a real underwriter or program.'
    };
  }
  async getProducts() {
    const base = await super.getProducts();
    return base.map((p) => ({ ...p, chainKind: 'solana' }));
  }
  getQuote(params) {
    return super.getQuote({ ...params, chainId: this.chainId });
  }
  async buildPurchaseTransaction(params) {
    const base = await super.buildPurchaseTransaction(params);
    return {
      ...base,
      chainKind: 'solana',
      chainId: this.chainId,
      to: SOLANA_SANDBOX_RECIPIENT,
      lamports: String(Number(params.premiumMicro ?? 0n) * 1n),
      instructions: [{ programId: 'SandboxInsurance111111111111111111111111', name: 'purchaseCoverage', note: 'simulated Solana instruction' }],
      note: 'Sandbox: simulated Solana premium transfer prepared for wallet signature.'
    };
  }
}
