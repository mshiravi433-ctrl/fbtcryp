/**
 * FBT Insurance OS — InsurAce adapter (LIVE provider integration, API-gated).
 *
 * Wired against the official surfaces only:
 *   - Base URL ...... https://api.insurace.io/ops/v1 (docs: service-integration)
 *   - Endpoints ..... getProductList, getCurrencyList, getCoverPremiumV2,
 *                     confirmCoverPremiumV2, buyCover, cancelCover
 *   - Auth .......... `code` query parameter (access key). The key is a SECRET:
 *                     environment only (INSURACE_API_CODE) — never bundled,
 *                     never committed, never logged.
 *   - Purchase ...... InsurAce Cover contract `buyCoverV3(...)` (signature
 *                     verified from the official ICover interface /
 *                     insurace-integration repo). The docs state the Cover
 *                     contract addresses are provided by the InsurAce team —
 *                     they are NOT public constants — so FBT reads them from
 *                     operator-verified env configuration only. Without a
 *                     verified address, purchase returns NOT_CONFIGURED and is
 *                     disabled; discovery and premium quoting still work.
 *
 * Purchase flow (per official docs):
 *   getCoverPremiumV2 → confirmCoverPremiumV2 → (user reviews premium/terms)
 *   → wallet approval if ERC20 → wallet signs buyCoverV3 → receipt verified.
 */
import { Interface, isAddress } from 'ethers';
import { InsuranceProviderAdapter } from '../adapter.js';
import { httpPost } from '../http.js';
import * as store from '../store.js';
import {
  INSURACE_ENABLED, INSURACE_API_BASE_URL, INSURACE_API_CODE,
  INSURACE_CHAIN_ALLOWLIST, INSURACE_COVER_CONTRACTS, PROVIDER_HTTP_TIMEOUT_MS
} from '../env.js';

/** InsurAce chain codes ↔ EVM chain ids (documented valid values: ETH, BSC, POLYGON, AVALANCHE). */
export const INSURACE_CHAINS = Object.freeze({
  ETH: 1,
  BSC: 56,
  POLYGON: 137,
  AVALANCHE: 43114
});

/** Official ICover.buyCoverV3 signature (insurace-integration + verified sources). */
const BUY_COVER_V3_ABI = [
  'function buyCoverV3(uint16[] products, uint16[] durationInDays, uint256[] amounts, address[] addresses, uint256 premiumAmount, uint256 referralCode, uint256[] helperParameters, uint256[] securityParameters, string freeText, uint8[] v, bytes32[] r, bytes32[] s) payable'
];
const ERC20_APPROVE_ABI = ['function approve(address spender, uint256 amount) returns (bool)'];

export class InsurAceAdapter extends InsuranceProviderAdapter {
  constructor(opts = {}) {
    super();
    this.apiBase = opts.apiBase || INSURACE_API_BASE_URL;
    this.apiCode = opts.apiCode ?? INSURACE_API_CODE;
    this.enabled = opts.enabled ?? INSURACE_ENABLED;
    this.timeoutMs = opts.timeoutMs || PROVIDER_HTTP_TIMEOUT_MS;
    this.chainCodes = (opts.chainAllowlist || INSURACE_CHAIN_ALLOWLIST)
      .map((c) => String(c).toUpperCase())
      .filter((c) => c in INSURACE_CHAINS);
    this.configured = this.enabled && !!this.apiCode && this.chainCodes.length > 0;
    this._currencyCache = null;
  }

  get supportedChains() { return this.chainCodes.map((c) => INSURACE_CHAINS[c]); }

  chainCodeFor(chainId) {
    return this.chainCodes.find((c) => INSURACE_CHAINS[c] === Number(chainId)) || null;
  }

  coverContractFor(chainId) {
    const code = this.chainCodeFor(chainId);
    const addr = code ? INSURACE_COVER_CONTRACTS[code] : '';
    return addr && isAddress(addr) ? addr : null;
  }

  getProviderInfo() {
    return {
      providerId: 'insurace',
      name: 'InsurAce',
      displayName: 'InsurAce',
      status: this.configured ? 'LIVE' : 'NOT_CONFIGURED',
      configured: this.configured,
      purchaseConfigured: this.chainCodes.some((c) => !!INSURACE_COVER_CONTRACTS[c]),
      apiBase: this.apiBase,
      documentationUrl: 'https://docs.insurace.io/landing-page/developer-reference/service-integration',
      supportedChains: this.supportedChains,
      chainCodes: this.chainCodes,
      coverContracts: Object.fromEntries(this.chainCodes.map((c) => [c, this.coverContractFor(INSURACE_CHAINS[c])])),
      claimMethod: 'InsurAce claim process (see provider docs)',
      disclaimer: 'Coverage is underwritten solely by InsurAce. FBT is a non-custodial interface and never guarantees payout.'
    };
  }

  async _post(endpoint, body) {
    if (!this.apiCode) {
      const err = new Error('INSURACE_API_CODE not configured');
      err.code = 'NOT_CONFIGURED';
      throw err;
    }
    const res = await httpPost(`${this.apiBase}/${endpoint}`, body, {
      timeoutMs: this.timeoutMs,
      query: { code: this.apiCode }
    });
    if (!res.ok) {
      const err = new Error(res.error?.kind === 'status' ? `InsurAce API HTTP ${res.status}` : `InsurAce API unreachable (${res.error?.kind})`);
      err.code = res.error?.kind === 'status' ? 'PROVIDER_HTTP_ERROR' : 'PROVIDER_UNAVAILABLE';
      err.providerStatus = res.error?.kind === 'status' ? 'DEGRADED' : 'UNAVAILABLE';
      throw err;
    }
    return res.data;
  }

  async _currencyList(chainCode) {
    const cached = this._currencyCache;
    if (cached && cached.chainCode === chainCode && Date.now() - cached.at < 300_000) return cached.rows;
    const data = await this._post('getCurrencyList', { chain: chainCode });
    const rows = Array.isArray(data?.result) ? data.result : Array.isArray(data) ? data : [];
    this._currencyCache = { chainCode, rows, at: Date.now() };
    return rows;
  }

  async getProducts() {
    if (!this.configured) return [];
    const rows = [];
    for (const chainCode of this.chainCodes) {
      let data;
      try {
        data = await this._post('getProductList', { chain: chainCode });
      } catch (err) {
        if (err.code === 'PROVIDER_HTTP_ERROR' || err.code === 'PROVIDER_UNAVAILABLE') throw err;
        continue; // chain-specific failure — skip this chain, no fabrication
      }
      const arr = Array.isArray(data?.result) ? data.result : Array.isArray(data) ? data : [];
      for (const p of arr) {
        const pid = p?.productId ?? p?.id;
        if (pid == null) continue;
        rows.push({
          providerProductId: String(pid),
          id: `insurace-${chainCode}-${pid}`,
          kind: 'smart-contract',
          label: p?.productName || p?.name || `InsurAce Product #${pid}`,
          name: p?.productName || p?.name || `InsurAce Product #${pid}`,
          chainCode,
          supportedChains: [INSURACE_CHAINS[chainCode]],
          // Capacity/price fields are passed through ONLY when present.
          capacity: p?.capacity ?? p?.capacityAmount ?? null,
          priceRate: p?.price ?? p?.priceRate ?? null,
          currency: null,
          claimMethod: 'insurace-claim',
          sandbox: false,
          sandboxProduct: false,
          termsUrl: 'https://docs.insurace.io/landing-page/documentation/faq'
        });
      }
    }
    return rows;
  }

  async getQuote(params) {
    if (!this.configured) return { ok: false, notConfigured: true, error: 'NOT_CONFIGURED' };
    const chainCode = this.chainCodeFor(params.chainId);
    if (!chainCode) {
      return { ok: false, error: 'CHAIN_UNSUPPORTED', detail: `InsurAce chains: ${this.chainCodes.join(', ')}` };
    }
    const productId = String(params.productId || params.providerProductId || '').replace(/^insurace-[A-Z]+-/, '');
    if (!productId || !/^\d+$/.test(productId)) {
      return { ok: false, error: 'PRODUCT_REQUIRED', detail: 'Select a concrete InsurAce product id.' };
    }
    const days = Math.round(Number(params.durationDays ?? 30));
    if (!(days >= 1 && days <= 365)) return { ok: false, error: 'DURATION_OUT_OF_RANGE' };
    const amountMicro = typeof params.coverageAmountMicro === 'bigint' ? params.coverageAmountMicro : null;
    if (!amountMicro || amountMicro <= 0n) return { ok: false, error: 'COVERAGE_AMOUNT_REQUIRED' };
    if (!params.walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(params.walletAddress)) {
      return { ok: false, error: 'VALID_WALLET_REQUIRED' };
    }
    if (params.termsAccepted !== true) {
      return { ok: false, error: 'TERMS_ACCEPTANCE_REQUIRED', detail: 'InsurAce terms must be accepted before quoting for purchase.' };
    }

    let currencies;
    try { currencies = await this._currencyList(chainCode); } catch { currencies = []; }
    // Prefer USDC/USDT-style stable for the premium; the API's own list decides.
    const stable = currencies.find((c) => ['USDC', 'USDT'].includes(String(c?.tokenSymbol || c?.symbol || '').toUpperCase()))
      || currencies[0] || null;
    const currencyAddr = stable?.tokenAddress || stable?.address || null;
    const currencyDecimals = Number(stable?.decimals ?? 6);
    const currencySymbol = String(stable?.tokenSymbol || stable?.symbol || 'UNKNOWN');
    if (!currencyAddr || !isAddress(currencyAddr)) {
      return { ok: false, error: 'CURRENCY_UNAVAILABLE', detail: 'getCurrencyList returned no usable premium currency' };
    }

    let premiumRes;
    try {
      premiumRes = await this._post('getCoverPremiumV2', {
        chain: chainCode,
        params: {
          owner: params.walletAddress,
          coverCurrency: currencyAddr,
          premiumCurrency: currencyAddr, // docs: must be the same as coverCurrency
          productIds: [Number(productId)],
          coverDays: [days],
          coverAmounts: [amountMicro.toString()], // decimals already 6 == micro
          coveredAddresses: [params.walletAddress],
          referralCode: null
        }
      });
    } catch (err) {
      return { ok: false, error: err.code === 'PROVIDER_HTTP_ERROR' ? 'QUOTE_REJECTED_BY_PROVIDER' : 'PROVIDER_UNAVAILABLE', detail: err.message, providerStatus: err.providerStatus };
    }

    const premiumRaw = premiumRes?.premium ?? premiumRes?.result?.premium ?? null;
    if (premiumRaw == null) return { ok: false, error: 'QUOTE_MALFORMED', detail: 'getCoverPremiumV2 returned no premium' };
    let premiumBase;
    try { premiumBase = BigInt(premiumRaw); } catch { return { ok: false, error: 'QUOTE_MALFORMED', detail: 'premium not an integer string' }; }
    const scale = 10n ** BigInt(Math.max(0, currencyDecimals - 6));
    const premiumMicro = premiumBase / scale;

    const confirmParams = premiumRes?.params ?? premiumRes?.result?.params ?? null; // opaque provider-signed params for confirm/buy

    return {
      ok: true,
      premiumMicro,
      premiumUsd: (premiumMicro).toString(),
      productId: `insurace-${chainCode}-${productId}`,
      providerProductId: String(productId),
      currency: currencySymbol,
      estimatedGas: null,
      at: Date.now(),
      purchaseReady: false, // flips true after confirmCoverPremiumV2 (time-sensitive)
      raw: {
        chainCode,
        productId: String(productId),
        coverCurrency: currencyAddr,
        premiumCurrency: currencyAddr,
        currencyDecimals,
        currencySymbol,
        premiumBase: premiumBase.toString(),
        premiumParams: confirmParams,
        premiumFetchedAt: Date.now()
      }
    };
  }

  /** confirmCoverPremiumV2 — required by the docs immediately before buying. */
  async confirmPremium(raw, owner) {
    const data = await this._post('confirmCoverPremiumV2', {
      chain: raw.chainCode,
      params: raw.premiumParams
    });
    const buyParams = data?.params ?? data?.result?.params ?? null;
    if (!Array.isArray(buyParams)) return { ok: false, error: 'CONFIRM_MALFORMED', detail: 'confirmCoverPremiumV2 returned no params array' };
    await store.set('provider-ledger', `insurace-confirm-${owner}-${raw.productId}`, {
      kind: 'premium-confirmation', chainCode: raw.chainCode, at: Date.now(), params: buyParams
    });
    return { ok: true, buyParams };
  }

  checkEligibility(params) {
    if (!this.configured) return Promise.resolve({ eligible: false, reason: 'NOT_CONFIGURED' });
    if (!this.chainCodeFor(params.chainId)) return Promise.resolve({ eligible: false, reason: 'CHAIN_UNSUPPORTED' });
    return Promise.resolve({ eligible: true, reason: 'OK' });
  }

  async createPurchaseIntent(params) {
    if (!this.configured) return { ok: false, notConfigured: true, error: 'NOT_CONFIGURED' };
    const intentId = `insurace-intent-${params.quoteId || params.coverageId}`;
    await store.set('provider-ledger', intentId, { kind: 'purchase-intent', provider: 'insurace', params, status: 'OPEN', unsignedOnly: true, at: Date.now() });
    return { ok: true, intentId, providerReference: intentId };
  }

  /**
   * Unsigned buyCoverV3 transaction. Requires the operator-verified Cover
   * contract address for the chain (docs: addresses come from the InsurAce
   * team). Without it → NOT_CONFIGURED and purchase stays disabled.
   */
  async buildPurchaseTransaction(params) {
    if (!this.configured) return { ok: false, notConfigured: true, error: 'NOT_CONFIGURED' };
    const raw = params.raw || params.quoteRaw || null;
    if (!raw?.chainCode) return { ok: false, error: 'PURCHASE_INPUTS_UNAVAILABLE', detail: 'obtain a fresh InsurAce quote first' };

    const chainId = INSURACE_CHAINS[raw.chainCode];
    const coverContract = this.coverContractFor(chainId);
    if (!coverContract) {
      return {
        ok: false,
        error: 'NOT_CONFIGURED',
        detail: `InsurAce Cover contract address for ${raw.chainCode} is not operator-verified (INSURACE_COVER_CONTRACT_ADDRESS_${raw.chainCode}). Purchase disabled — FBT does not guess contract addresses.`
      };
    }

    // confirmCoverPremiumV2 must run at purchase time (provider-signed, short-lived).
    let buyParams;
    try {
      const confirmed = await this.confirmPremium(raw, String(params.walletAddress || '').toLowerCase());
      if (!confirmed.ok) return confirmed;
      buyParams = confirmed.buyParams;
    } catch (err) {
      return { ok: false, error: err.code === 'PROVIDER_HTTP_ERROR' ? 'CONFIRM_REJECTED_BY_PROVIDER' : 'PROVIDER_UNAVAILABLE', detail: err.message, providerStatus: err.providerStatus };
    }

    // buyParams (per docs) = [products, durations, amounts, addresses, premium, referral, helper, security, freeText, v, r, s]
    const [products, durations, amounts, addresses, premiumAmount, referralCode, helperParameters, securityParameters, freeText, vs, rs, ss] = buyParams;
    const iface = new Interface(BUY_COVER_V3_ABI);
    const data = iface.encodeFunctionData('buyCoverV3', [products, durations, amounts, addresses, premiumAmount, referralCode, helperParameters, securityParameters, freeText, vs, rs, ss]);

    const value = BigInt(helperParameters?.[0] ?? 0); // helperParameters[0] carries msgValue per integration docs
    const isNative = value > 0n;
    const approvalTx = isNative ? null : {
      unsigned: true,
      kind: 'erc20-approve',
      chainId,
      tokenAddress: raw.premiumCurrency,
      spender: coverContract,
      amount: premiumAmount?.toString() || '0',
      note: 'ERC20 approval for the InsurAce Cover contract.'
    };

    return {
      ok: true,
      sandbox: false,
      unsigned: true,
      tx: {
        unsigned: true,
        kind: 'evm-contract-call',
        chainId,
        to: coverContract,
        data,
        value: value.toString(),
        from: String(params.walletAddress || '').toLowerCase(),
        gasEstimate: null,
        provider: 'insurace',
        settlementModel: 'DIRECT',
        custody: 'none — premium moves wallet → InsurAce Cover on-chain'
      },
      approvalTx,
      reference: {
        quoteId: params.quoteId, termsHash: params.termsHash,
        providerProductId: raw.productId,
        premiumBase: raw.premiumBase
      },
      note: 'Unsigned InsurAce buyCoverV3 prepared from a fresh provider confirmation. Your wallet signs; FBT never touches keys.'
    };
  }

  async getCoverage() { return { ok: false, error: 'NOT_AVAILABLE', detail: 'coverage state verified on-chain from the InsurAce Cover contract receipt' }; }

  async submitClaim() {
    return {
      ok: true,
      claimMethod: 'insurace-claim',
      detail: 'Claims are filed with InsurAce per their process. FBT tracks and independently verifies the payout on-chain.',
      howTo: 'https://docs.insurace.io/landing-page/documentation/faq'
    };
  }

  async getClaimStatus() { return { ok: false, error: 'NOT_AVAILABLE', detail: 'status lives with InsurAce claims process' }; }
  async getPayout() { return { ok: false, error: 'NOT_AVAILABLE', detail: 'payout verified on-chain, not from an API' }; }
  async cancelCoverage(params) {
    // cancelCover exists on the InsurAce Cover contract (ICover.cancelCover) —
    // exposed only as a signed user action, never server-executed.
    return { ok: true, claimMethod: 'user-signed', detail: 'cancelCover(coverId) is signed by the cover owner in their wallet; FBT prepares it on request.' };
  }

  async health() {
    if (!this.configured) return { ok: false, status: 'NOT_CONFIGURED', at: Date.now(), reason: 'INSURACE_API_CODE not set (env-only secret)' };
    const t0 = Date.now();
    try {
      await this._post('getProductList', { chain: this.chainCodes[0] });
      return { ok: true, status: 'HEALTHY', latencyMs: Date.now() - t0, at: Date.now(), live: true };
    } catch (err) {
      return {
        ok: false,
        status: err.code === 'PROVIDER_HTTP_ERROR' ? 'DEGRADED' : 'UNAVAILABLE',
        latencyMs: Date.now() - t0, at: Date.now(), reason: err.message, live: false
      };
    }
  }
}
